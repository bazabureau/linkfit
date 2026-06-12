import Foundation
import Observation
import UIKit

/// Drives the Create Squad form. Owns name + description + photo +
/// max_size; submits a single POST and surfaces network failure as a
/// form-inline error message.
///
/// Photo upload is two-phase: we POST the image bytes to the shared
/// `/api/v1/messages/upload-image` endpoint first (returns an absolute
/// URL), then send that URL inside the create payload. The view captures
/// the picked `UIImage` and hands it back to `submit()`, which handles
/// the JPEG encoding + upload before the create call.
@Observable
@MainActor
final class CreateSquadViewModel {

    // MARK: - Form state

    /// Squad display name. Server-clamped to 2…50 characters; the
    /// `canSubmit` flag mirrors that so the user can't submit a name that
    /// would fail validation. Leading / trailing whitespace is trimmed
    /// before the API call.
    var name: String = ""
    /// Optional. Empty string + the trimmed value sent as `nil` so the
    /// server stores `NULL` rather than an empty body.
    var description: String = ""
    /// Maximum members allowed in the squad. Default 4 — the canonical
    /// padel doubles count. Stepped 2…8 by the UI.
    var maxSize: Int = 4
    /// Locally-picked image. Encoded + uploaded inside `submit()` so the
    /// upload happens at the same moment the squad is created (avoids
    /// the orphan-photo state where an upload succeeds but the create
    /// fails mid-flight, leaving an unreferenced image on the server).
    var pickedPhoto: UIImage?

    // MARK: - UI state

    /// True while the submit button has fired and we're waiting on the
    /// network. View disables the CTA + shows a spinner.
    private(set) var isSubmitting = false
    /// One-line form error. Cleared on each submission attempt; shown
    /// inline under the submit button on failure.
    var formError: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Server-mirrored validation. `name` length 2…50, `max_size` 2…8.
    /// Mirrors backend rules exactly so the only failure that should
    /// reach `formError` is a transport / auth problem.
    var canSubmit: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let len = trimmed.count
        return len >= 2 && len <= 50 && (2...8).contains(maxSize) && !isSubmitting
    }

    /// Submit handler. Performs the optional image upload first (when a
    /// photo is picked), then POSTs the create body. On success returns
    /// the persisted `Squad`; on failure sets `formError` and returns nil.
    @discardableResult
    func submit() async -> Squad? {
        formError = nil
        guard canSubmit else { return nil }
        isSubmitting = true
        defer { isSubmitting = false }

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDesc = description.trimmingCharacters(in: .whitespacesAndNewlines)

        // Upload the photo first if one was picked. JPEG at 0.85 quality
        // — squad-card medallions render at <= 96pt so the extra fidelity
        // of higher-quality JPEGs is wasted. Failure here is fatal to the
        // submit because the user explicitly picked an image; we surface
        // the error rather than silently dropping the photo.
        var photoURL: String? = nil
        if let image = pickedPhoto {
            guard let data = image.jpegData(compressionQuality: 0.85) else {
                formError = String(localized: "squads.create.error.photo_encode")
                return nil
            }
            do {
                let upload = try await apiClient.uploadImage(
                    imageData: data,
                    mimeType: "image/jpeg",
                    filename: "squad-\(UUID().uuidString).jpg"
                )
                photoURL = upload.url
            } catch let error as APIError {
                formError = error.localizedMessage
                return nil
            } catch {
                formError = error.localizedDescription
                return nil
            }
        }

        let body = CreateSquadBody(
            name: trimmedName,
            description: trimmedDesc.isEmpty ? nil : trimmedDesc,
            photo_url: photoURL,
            max_size: maxSize
        )
        do {
            let squad = try await apiClient.send(Endpoint<Squad>.createSquad(body))
            // Analytics — `squad_created` fires once per successful squad
            // create. `member_count: 1` reflects the creator-only state
            // at the moment of creation; later invites mutate this on
            // the server side, not in this funnel event.
            Analytics.track(.squadCreated(memberCount: 1))
            return squad
        } catch let error as APIError {
            formError = error.localizedMessage
            return nil
        } catch {
            formError = error.localizedDescription
            return nil
        }
    }

    /// UIKit clamp helper used by the stepper buttons in the view. Keeps
    /// the bound logic out of the view layer where it'd be repeated.
    func clamp(_ value: Int) -> Int {
        Swift.max(2, Swift.min(8, value))
    }
}
