import Foundation
import Observation
import UIKit

/// Backing state for the StoryCreator flow.
///
/// State machine:
///   * `.camera`              → Instagram-style camera-first viewfinder
///                               (default landing — full-screen
///                               `AVCaptureSession` preview with capture
///                               button + library-thumbnail fallback).
///   * `.editing(UIImage)`    → user picked or captured an image, currently
///                               in PhotoCrop.
///   * `.editor(StoryEditorViewModel)` → Wave-12: post-crop overlay editor
///                               (text / mention / sticker placement with
///                               drag/pinch/rotate). Owns its own VM so
///                               `[StoryOverlay]` mutations stay isolated
///                               from this state machine.
///   * `.composing(UIImage, [StoryOverlay])` → editor confirmed; show the
///                               caption field + Post button. The overlay
///                               list rides along to the upload step so
///                               we can convert it to the wire format
///                               (`StoryOverlayWire` + `StoryMentionInput`)
///                               just before POST.
///   * `.uploading(progress)` → multipart upload in flight (0…1).
///   * `.error(String)`       → recoverable error after upload/create failure.
///
/// We split `editing`, `editor`, and `composing` because each is a
/// distinct full-screen surface — the PhotoCropView is its own modal, the
/// overlay editor is a sibling, and the composer (caption + Post) is the
/// final step. Going back from any step drops the user into the camera
/// where they can either re-shoot, re-pick from the library, or restart
/// the flow. The overlay list is dropped on cancel: re-entering the
/// editor with a new crop starts fresh (matches Instagram).
///
/// Wave-12 note: the legacy `.idle` chooser (two-button library/camera
/// menu) was retired in favour of a camera-first flow that matches IG /
/// Snap — `.camera` is the default landing and exposes both capture and
/// library entry from the same surface. The post-crop overlay editor was
/// also added in Wave-12; before the lifecycle hotfix the editor existed
/// in isolation (`StoryEditorView` + `StoryEditorViewModel`) but was
/// never wired into the creator, so overlays/mentions silently never
/// reached the server. This file now bridges the gap.
@Observable
@MainActor
final class StoryCreatorViewModel {
    enum Phase {
        case camera
        case editing(UIImage)
        case editor(StoryEditorViewModel)
        case composing(UIImage, [StoryOverlay])
        case uploading(progress: Double)
        case error(String)
    }

    var phase: Phase = .camera
    var caption: String = ""

    /// Cached composing payload (cropped image + overlay list) so an
    /// upload/create failure can drop the user back into `.composing`
    /// with their work intact instead of discarding it to `.camera`.
    /// Set whenever we leave `.composing` for `.uploading`; consumed by
    /// `dismissError()` on retry. Cleared after a successful post or a
    /// deliberate return to the camera so a stale payload never leaks
    /// into a fresh flow.
    private var pendingComposition: (image: UIImage, overlays: [StoryOverlay])?

    /// On a successful post the host dismisses + the rail's VM gets the
    /// fresh story optimistically prepended. We use a callback (rather
    /// than a hard reference back to the rail VM) so the creator stays
    /// decoupled and unit-testable.
    let onPosted: (Story) -> Void

    private let apiClient: APIClient

    init(apiClient: APIClient, initialImage: UIImage? = nil, onPosted: @escaping (Story) -> Void) {
        self.apiClient = apiClient
        self.onPosted = onPosted
        
        if let initialImage {
            // Jump straight to the overlay editor for pre-rendered cards / milestones
            let editorVM = StoryEditorViewModel(
                image: initialImage,
                onNext: { [weak self] finalImage, overlays in
                    Task { @MainActor in
                        self?.didFinishEditing(image: finalImage, overlays: overlays)
                    }
                },
                onClose: { [weak self] in
                    Task { @MainActor in
                        self?.cancelEditor()
                    }
                }
            )
            self.phase = .editor(editorVM)
        } else {
            self.phase = .camera
        }
    }

    // MARK: - Picker callbacks

    /// Called once the PhotosPicker resolves a `UIImage`. Jumps straight
    /// to editing. We do NOT decode-on-background-thread here because
    /// UIImage's lazy-decode kicks in on first draw anyway; pushing the
    /// decode off the main actor would introduce a Sendable wrapper for
    /// minimal gain.
    func didPickImage(_ image: UIImage) {
        phase = .editing(image)
    }

    /// Crop confirmed → push into the Wave-12 overlay editor (text /
    /// mention / sticker placement). The editor owns its own VM so its
    /// overlay list, in-flight gestures, and sheet state stay isolated
    /// from this state machine. The `onNext` closure routes the user
    /// forward into `.composing` with the final overlay list attached;
    /// `onClose` drops them back to the camera so they can re-shoot.
    func didConfirmCrop(_ image: UIImage) {
        let editorVM = StoryEditorViewModel(
            image: image,
            onNext: { [weak self] finalImage, overlays in
                Task { @MainActor [weak self] in
                    self?.didFinishEditing(image: finalImage, overlays: overlays)
                }
            },
            onClose: { [weak self] in
                Task { @MainActor [weak self] in
                    self?.cancelEditor()
                }
            }
        )
        phase = .editor(editorVM)
    }

    /// Editor "İrəli" tapped — promote the annotated image + overlay
    /// list to the caption-composing phase. The overlays ride along so
    /// `post()` can convert them to the wire format on send.
    func didFinishEditing(image: UIImage, overlays: [StoryOverlay]) {
        phase = .composing(image, overlays)
    }

    /// Editor close (✕) — drop back to the camera. Discards the overlay
    /// list intentionally: re-entering the editor through a fresh crop
    /// starts clean, matching Instagram's behavior on cancel.
    func cancelEditor() {
        phase = .camera
    }

    func cancelCrop() {
        // Drop back to camera so the user can re-shoot or re-pick from
        // the library thumbnail. We could keep the unedited image and
        // let them re-edit, but PhotoCropView doesn't preserve gesture
        // state across reopens and the UX is cleaner if cancel means
        // "discard". The camera viewfinder is the same surface that
        // launched the flow, so returning there keeps the mental model
        // consistent.
        phase = .camera
    }

    // MARK: - Post

    /// Two-step post:
    ///   1. Upload the cropped image as JPEG via the shared
    ///      `/api/v1/messages/upload-image` multipart endpoint.
    ///   2. Submit `POST /api/v1/stories` with the returned URL +
    ///      caption + Wave-12 overlays + Wave-12 mentions.
    /// On success: invoke `onPosted(story)` and leave phase = idle so
    /// the host can dismiss without flicker.
    ///
    /// **Wave-12 conversion.** The editor's `[StoryOverlay]` is a
    /// heterogeneous enum (text / mention / sticker). The server's
    /// `CreateStoryBody` splits these into two parallel arrays:
    ///   - `overlays: [StoryOverlayWire]` — text + sticker only,
    ///     payload is opaque JSONB.
    ///   - `mentions: [StoryMentionInput]` — `(user_id, x, y)` triples
    ///     normalized into the `story_mentions` table server-side.
    /// We do that conversion right before POST so the editor's enum
    /// stays the single source of truth in the UI layer.
    func post() async {
        guard case .composing(let image, let overlays) = phase else { return }

        // Cache the cropped image + overlays so any failure below can
        // restore the user to `.composing` with their work intact (the
        // crop + every overlay they placed) rather than dumping them
        // back at the camera and forcing a full re-shoot.
        pendingComposition = (image, overlays)

        // 1. JPEG encode at 0.85 quality — same setting MessagesView
        // uses for chat attachments. Stories are usually viewed full-
        // screen so we don't want to crank the compression any harder.
        guard let jpeg = image.jpegData(compressionQuality: 0.85) else {
            phase = .error(String(localized: "common.error.generic"))
            return
        }

        phase = .uploading(progress: 0)

        do {
            // Multipart upload with progress reporting. The closure runs
            // on URLSession's delegate queue — hop back to main actor.
            let uploaded = try await apiClient.uploadImage(
                imageData: jpeg,
                mimeType: "image/jpeg",
                filename: "story.jpg",
                onProgress: { [weak self] p in
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        // Only forward progress while we're still in
                        // the uploading phase — late callbacks after
                        // success/failure shouldn't bounce the bar.
                        if case .uploading = self.phase {
                            self.phase = .uploading(progress: p)
                        }
                    }
                }
            )

            // 2. Convert the editor's `[StoryOverlay]` enum into the two
            // parallel wire arrays the server expects. We compact-map
            // so a future overlay variant ("poll", "music") that doesn't
            // map cleanly is dropped silently rather than poisoning the
            // POST body. Nil-out the arrays when empty so the server's
            // optional defaults kick in (also keeps pre-Wave-12 servers
            // happy).
            let wireOverlays = overlays.compactMap { $0.wireValue }
            let wireMentions = overlays.compactMap { overlay -> StoryMentionInput? in
                if case let .mention(payload) = overlay {
                    return StoryMentionInput(
                        user_id: payload.user_id,
                        x: Double(payload.x),
                        y: Double(payload.y)
                    )
                }
                return nil
            }

            // 3. Create the story. Empty captions go on the wire as
            // null so the server's optional column behaves right.
            let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
            let body = CreateStoryRequest(
                media_url: uploaded.url,
                media_type: "image",
                caption: trimmed.isEmpty ? nil : trimmed,
                overlays: wireOverlays.isEmpty ? nil : wireOverlays,
                mentions: wireMentions.isEmpty ? nil : wireMentions
            )
            let story = try await apiClient.send(Endpoint.createStory(body))
            // Analytics — `story_posted` fires once per successful story
            // create. We ship `has_caption` so the dashboard can split
            // "story posted" vs. "captioned story posted" without us
            // ever shipping the caption text itself.
            Analytics.track(.storyPosted(hasCaption: trimmed.isEmpty == false))
            onPosted(story)
            // Reset to the camera landing so a re-presentation of the
            // creator starts from a clean state (matches the default
            // entry point — see `Phase` doc).
            pendingComposition = nil
            phase = .camera
            caption = ""
        } catch let error as APIError {
            phase = .error(error.localizedMessage)
        } catch is CancellationError {
            // User backgrounded the app or dismissed mid-upload. Drop
            // back to composing so they can retry without re-picking —
            // preserve their overlay list so they don't have to rebuild
            // it.
            if case .uploading = phase {
                phase = .composing(image, overlays)
                pendingComposition = nil
            }
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    /// Re-enter composing after an error — wires the inline "Try
    /// again" button. We cache the cropped image + overlay list in
    /// `pendingComposition` before every upload, so a failed
    /// upload/create can drop the user straight back into `.composing`
    /// with their crop and every overlay intact — they just tap Post
    /// again. We deliberately keep `caption` so the user doesn't lose
    /// that either. Only when there's nothing cached (defensive — e.g.
    /// the pre-upload JPEG-encode guard fired with no prior payload)
    /// do we fall back to the camera landing.
    func dismissError() {
        if let pending = pendingComposition {
            phase = .composing(pending.image, pending.overlays)
        } else {
            phase = .camera
        }
    }
}
