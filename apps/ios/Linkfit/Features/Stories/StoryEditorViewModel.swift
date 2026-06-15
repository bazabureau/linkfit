import Foundation
import Observation
import UIKit

/// State holder for the story editor (the screen that sits between the
/// raw image and the caption/post composer).
///
/// The editor's job is to let the user place text/mention/sticker
/// overlays on top of a chosen image. Once they tap "İrəli" (Next), the
/// editor hands the host an annotated bundle: the original image + the
/// final list of overlays + a flat rendered version for upload.
///
/// We intentionally keep this model thin: the canvas view drives drag/
/// pinch/rotate gestures directly against the `overlays` binding, and
/// the editor sheet writes back via `updateTextOverlay(_:)`. The VM
/// owns:
///   * `overlays` — the canonical ordered list (back-to-front).
///   * `editingOverlayID` — which one's sheet is open, if any.
///   * Helpers for add/select/delete + a single "find the text overlay
///     I'm editing" lookup used by the sheet.
@Observable
@MainActor
final class StoryEditorViewModel {
    /// The image the user picked / cropped. Immutable for the editor's
    /// lifetime — re-cropping happens upstream (`StoryCreator`'s
    /// `.editing` phase).
    let image: UIImage

    /// Ordered overlays, back-to-front. The view's `ZStack` renders in
    /// order so the last element sits on top.
    var overlays: [StoryOverlay] = []

    /// Instagram-style colour filter applied to the live preview and
    /// baked into the final image on submit. Defaults to `.original`
    /// (no filter). The editor view reads `filteredImage` for its
    /// preview; the filter row writes back here when the user taps a
    /// tile. Stored as the enum (not the params) so it's cheap to
    /// compare and persist if we ever add filter analytics.
    var selectedFilter: StoryFilter = .original

    /// Live preview image with `selectedFilter` applied. Computed on
    /// every access — the renderer's identity fast-path makes the
    /// `.original` case nearly free, and non-identity filters cost
    /// ~20-30ms on an A17 (4K input). We accept the per-selection cost
    /// rather than caching: the alternative would be a stale cache
    /// when the filter changes, which is the common case here.
    ///
    /// **Caveat.** SwiftUI re-evaluates the computed on every body
    /// invocation that reads it. To avoid re-rendering during
    /// unrelated state changes (overlay drags), the view should read
    /// this through a `let preview = viewModel.filteredImage` capture
    /// outside the gesture-driven branches.
    var filteredImage: UIImage {
        StoryFilterRenderer.apply(filter: selectedFilter, to: image)
    }

    /// Which overlay (if any) currently has the text-editor sheet open.
    /// Nil = no sheet. We store the id rather than the whole payload so
    /// gesture-driven mutations to position/scale don't clobber the
    /// sheet's binding.
    var editingTextOverlayID: UUID?

    /// True while a destructive-action confirm is on screen. The view
    /// uses this to drive a `.confirmationDialog`. Stored as a separate
    /// id (not a bool) so we can show the dialog for a specific overlay
    /// — handy when a future "long-press menu" lands.
    var pendingDeleteID: UUID?

    /// Invoked when the user taps "İrəli" (Next). The host wires this to
    /// transition the parent flow to the caption-composing phase with
    /// the annotated image. Passes back the original image, the overlay
    /// list, and a callable to render the flattened bitmap (defer the
    /// render until the host actually needs it — most callers want the
    /// flattened bitmap, but unit tests don't).
    let onNext: (UIImage, [StoryOverlay]) -> Void

    /// Closure invoked on the close (✕) button. The host pops back to
    /// the cropper / picker so the user can re-pick the underlying image.
    let onClose: () -> Void

    init(
        image: UIImage,
        onNext: @escaping (UIImage, [StoryOverlay]) -> Void,
        onClose: @escaping () -> Void
    ) {
        self.image = image
        self.onNext = onNext
        self.onClose = onClose
    }

    // MARK: - Text tool

    /// Spawn a fresh text overlay centred on the canvas and open the
    /// edit sheet immediately so the user can start typing. Same UX
    /// flow as Instagram's "Aa" button.
    func addTextOverlay() {
        let new = StoryTextOverlay()
        overlays.append(.text(new))
        editingTextOverlayID = new.id
    }

    /// Look up the current text overlay being edited. Returns nil if
    /// the sheet is closed or the overlay is no longer a text payload
    /// (defensive — shouldn't happen but cheap to guard).
    func editingTextOverlay() -> StoryTextOverlay? {
        guard let id = editingTextOverlayID else { return nil }
        for overlay in overlays {
            if case .text(let payload) = overlay, payload.id == id {
                return payload
            }
        }
        return nil
    }

    /// Replace the in-place payload for a text overlay (called when the
    /// editor sheet's "Tamam" lands). We splice in the new payload so
    /// the z-order stays the same.
    ///
    /// Side effect: closes the sheet (sets `editingTextOverlayID = nil`).
    func updateTextOverlay(_ updated: StoryTextOverlay) {
        guard let index = overlays.firstIndex(where: { $0.id == updated.id }) else { return }
        // If the user cleared the field, drop the overlay outright —
        // matches Instagram, where an empty text bubble disappears on
        // close.
        let trimmed = updated.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            overlays.remove(at: index)
        } else {
            overlays[index] = .text(updated)
        }
        editingTextOverlayID = nil
    }

    /// Cancel the text editor without applying changes. If the overlay
    /// was freshly-spawned (never had text) we drop it; otherwise we
    /// leave the original payload in place.
    func cancelTextEdit() {
        if let id = editingTextOverlayID,
           let index = overlays.firstIndex(where: { $0.id == id }) {
            if case .text(let payload) = overlays[index],
               payload.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                overlays.remove(at: index)
            }
        }
        editingTextOverlayID = nil
    }

    // MARK: - Selection / deletion

    /// Open the text editor sheet for a tapped text overlay. No-op for
    /// non-text overlays (mention/sticker editing flow lives in those
    /// agents' files).
    func tapOverlay(_ id: UUID) {
        for overlay in overlays {
            if overlay.id == id, case .text = overlay {
                editingTextOverlayID = id
                return
            }
        }
    }

    /// Request deletion of an overlay (typically wired to a double-tap).
    /// The view drives the confirmation dialog from `pendingDeleteID`.
    func requestDelete(_ id: UUID) {
        pendingDeleteID = id
    }

    /// Actually remove the overlay (called from the confirmation
    /// dialog's destructive button).
    func confirmDelete() {
        guard let id = pendingDeleteID else { return }
        overlays.removeAll { $0.id == id }
        pendingDeleteID = nil
    }

    /// Dismiss the confirmation dialog without deleting.
    func cancelDelete() {
        pendingDeleteID = nil
    }

    // MARK: - Submit

    /// Forward the annotated payload to the host. The host renders the
    /// final flattened image (we don't do it here so the VM stays UIKit-
    /// free at the call site — the renderer needs a SwiftUI hierarchy).
    ///
    /// **Filter baking.** We apply `selectedFilter` to the image RIGHT
    /// HERE before forwarding so the host's flatten step (overlays
    /// composited on top) sees the filtered image as its base. The
    /// filter is a pixel-level transform, not a wire overlay — the
    /// server has no concept of it. The identity fast-path means the
    /// no-filter case (~80% of posts, IG telemetry suggests) costs
    /// nothing.
    func submit() {
        let baked = StoryFilterRenderer.apply(filter: selectedFilter, to: image)
        onNext(baked, overlays)
    }

    /// Like `submit()` but the host already flattened photo + overlays into
    /// one bitmap, so the posted story actually shows the text / stickers /
    /// mentions / drawings the user placed (previously they were dropped —
    /// `submit()` baked only the colour filter). Overlays still ride the
    /// wire array for mention tap-linking + notifications.
    func submitFlattened(_ flattened: UIImage) {
        onNext(flattened, overlays)
    }
}
