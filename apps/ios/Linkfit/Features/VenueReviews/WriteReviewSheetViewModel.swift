import Foundation
import Observation

/// View model for `WriteReviewSheet`. Handles the rating/body draft, the
/// optional photo upload via the shared `APIClient.uploadImage(...)`, and
/// the POST that creates-or-updates the review.
@Observable
@MainActor
final class WriteReviewSheetViewModel {
    let venueId: String
    var rating: Int = 0
    var body: String = ""
    /// Server-side URL once the photo upload completes. Local pickers set
    /// `pendingImageData`; this stays nil until upload succeeds.
    private(set) var uploadedPhotoUrl: String?
    /// JPEG bytes the user picked. Held in memory so we can render a
    /// preview before upload finishes.
    var pendingImageData: Data?
    private(set) var isUploadingPhoto = false
    /// 0.0-1.0 progress for an in-flight photo upload. Reset between
    /// uploads. The view animates a `Circle().trim(...)` from this
    /// value while `isUploadingPhoto == true`.
    private(set) var uploadProgress: Double = 0
    /// True when the most recent upload attempt failed. Cleared when
    /// the user retries or removes the photo.
    private(set) var uploadFailed: Bool = false
    private(set) var isSubmitting = false
    var errorMessage: String?

    private let apiClient: APIClient

    static let bodyMaxLength = 500

    init(venueId: String, apiClient: APIClient) {
        self.venueId = venueId
        self.apiClient = apiClient
    }

    /// Pre-fill the form when the user already has a review on this venue.
    /// The sheet can be re-opened to edit; we don't fetch the existing row
    /// ourselves because the parent screen already has it.
    func prefill(from existing: VenueReview) {
        rating = existing.rating
        body = existing.body ?? ""
        uploadedPhotoUrl = existing.photo_url
    }

    /// Trim the draft body. Surfaces the trimmed length in the character
    /// counter so trailing whitespace doesn't push the user past the cap.
    var trimmedBody: String {
        body.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var canSubmit: Bool {
        rating > 0 &&
        trimmedBody.count <= Self.bodyMaxLength &&
        !isSubmitting &&
        !isUploadingPhoto
    }

    /// Kick off a photo upload. The caller is responsible for transcoding
    /// HEIC to JPEG before calling this — we send the bytes verbatim.
    /// Reports per-byte progress into `uploadProgress` so the preview
    /// can render a determinate ring overlay.
    func uploadPhoto(_ data: Data, mimeType: String) async {
        pendingImageData = data
        isUploadingPhoto = true
        uploadProgress = 0
        uploadFailed = false
        defer { isUploadingPhoto = false }
        do {
            let res = try await apiClient.uploadImage(
                imageData: data,
                mimeType: mimeType,
                filename: "review-\(UUID().uuidString).jpg",
                onProgress: { [weak self] value in
                    // Hop to the main actor — URLSession's delegate
                    // queue is arbitrary and `uploadProgress` is
                    // @MainActor isolated.
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        // Monotonic — never let progress regress on a
                        // late-arriving smaller value (can happen when
                        // multiple retries fire from the runtime).
                        if value > self.uploadProgress {
                            self.uploadProgress = value
                        }
                    }
                }
            )
            uploadedPhotoUrl = res.url
            uploadProgress = 1
        } catch is CancellationError {
            return
        } catch let error as APIError {
            errorMessage = error.localizedMessage
            pendingImageData = nil
            uploadFailed = true
        } catch {
            errorMessage = error.localizedDescription
            pendingImageData = nil
            uploadFailed = true
        }
    }

    func clearPhoto() {
        pendingImageData = nil
        uploadedPhotoUrl = nil
        uploadProgress = 0
        uploadFailed = false
    }

    /// Submit the review. Returns the canonical row on success; the
    /// parent screen calls `VenueReviewsViewModel.acceptNewReview` with
    /// the result so the list updates without a round-trip.
    func submit() async -> VenueReview? {
        guard canSubmit else { return nil }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let review = try await apiClient.send(
                .upsertVenueReview(venueId: venueId,
                                   rating: rating,
                                   body: trimmedBody.isEmpty ? nil : trimmedBody,
                                   photoUrl: uploadedPhotoUrl)
            )
            return review
        } catch is CancellationError {
            return nil
        } catch let error as APIError {
            errorMessage = error.localizedMessage
            return nil
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
