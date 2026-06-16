import Foundation
import Observation
import UIKit

@Observable
@MainActor
final class EditProfileViewModel {
    var displayName: String
    var photoUrl: String
    var hasLocation: Bool
    var homeLat: Double
    var homeLng: Double
    var isSubmitting = false
    var isProcessingPhoto = false
    var formError: String?

    /// Maximum side length for the encoded avatar.
    /// 512px @ 0.78 JPEG ≈ 35–60 KB ⇒ ~50–80 KB as base64.
    private let maxSide: CGFloat = 512
    private let jpegQuality: CGFloat = 0.78

    private let apiClient: APIClient
    private let container: AppContainer
    private let initialDisplayName: String
    private let initialPhotoUrl: String
    private let initialHasLocation: Bool
    private let initialHomeLat: Double
    private let initialHomeLng: Double

    init(apiClient: APIClient, container: AppContainer, user: PublicUser) {
        self.apiClient = apiClient
        self.container = container
        self.displayName = user.display_name
        self.photoUrl = user.photo_url ?? ""
        self.initialDisplayName = user.display_name
        self.initialPhotoUrl = user.photo_url ?? ""
        let resolvedHasLocation: Bool
        let resolvedHomeLat: Double
        let resolvedHomeLng: Double
        if let lat = user.home_lat, let lng = user.home_lng {
            resolvedHasLocation = true
            resolvedHomeLat = lat
            resolvedHomeLng = lng
        } else {
            resolvedHasLocation = false
            resolvedHomeLat = 40.4093
            resolvedHomeLng = 49.8671
        }
        self.hasLocation = resolvedHasLocation
        self.homeLat = resolvedHomeLat
        self.homeLng = resolvedHomeLng
        self.initialHasLocation = resolvedHasLocation
        self.initialHomeLat = resolvedHomeLat
        self.initialHomeLng = resolvedHomeLng
    }

    var trimmedDisplayName: String {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var isDirty: Bool {
        trimmedDisplayName != initialDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        || photoUrl != initialPhotoUrl
        || hasLocation != initialHasLocation
        || (hasLocation && (abs(homeLat - initialHomeLat) > 0.000001 || abs(homeLng - initialHomeLng) > 0.000001))
    }

    var validationMessage: String? {
        if trimmedDisplayName.isEmpty {
            return String(localized: "edit_profile.field.display_name.placeholder")
        }
        if hasLocation && !(homeLat >= -90 && homeLat <= 90 && homeLng >= -180 && homeLng <= 180) {
            return String(localized: "edit_profile.error.save")
        }
        return nil
    }

    var canSubmit: Bool {
        validationMessage == nil && isDirty && !isSubmitting && !isProcessingPhoto
    }

    /// Encode a freshly picked photo into a downscaled JPEG data URL stored
    /// in `photoUrl`. Anything larger than `maxSide` is resized in-place so we
    /// don't ship multi-MB rows to the server.
    func setPhoto(from data: Data) async {
        isProcessingPhoto = true
        formError = nil
        defer { isProcessingPhoto = false }

        let scaled: String? = await Task.detached(priority: .userInitiated) { [maxSide, jpegQuality] in
            guard let image = UIImage(data: data) else { return nil }
            let resized = Self.downscale(image, maxSide: maxSide)
            guard let jpeg = resized.jpegData(compressionQuality: jpegQuality) else { return nil }
            return "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
        }.value

        if let scaled {
            photoUrl = scaled
        } else {
            formError = String(localized: "edit_profile.error.photo")
        }
    }

    func clearPhoto() {
        photoUrl = ""
    }

    nonisolated private static func downscale(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let w = image.size.width
        let h = image.size.height
        let longest = max(w, h)
        guard longest > maxSide else { return image }
        let scale = maxSide / longest
        let target = CGSize(width: w * scale, height: h * scale)
        let renderer = UIGraphicsImageRenderer(size: target)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    func submit() async -> Bool {
        formError = nil
        if let validationMessage {
            formError = validationMessage
            return false
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            // Build the PATCH body by hand so turning Home-location OFF sends an
            // explicit JSON `null` for the coords (clearing them server-side)
            // instead of dropping the keys. The `updateMe` helper only emits a
            // key when its `Double?` arg is non-nil, so a plain `nil` would be a
            // silent no-op and stale coords would survive. `NSNull()` is the
            // codebase idiom for a JSON null (see Endpoint+NotificationPreferences).
            var body: [String: Any] = [
                "display_name": trimmedDisplayName,
                "photo_url": photoUrl.isEmpty ? NSNull() : photoUrl as Any
            ]
            if hasLocation {
                body["home_lat"] = homeLat
                body["home_lng"] = homeLng
            } else {
                body["home_lat"] = NSNull()
                body["home_lng"] = NSNull()
            }
            let endpoint = Endpoint<PublicUser>(
                method: .patch,
                path: "/api/v1/me",
                body: try? JSONSerialization.data(withJSONObject: body),
                requiresAuth: true
            )
            let updated = try await apiClient.send(endpoint)
            container.updateCurrentUser(updated)
            return true
        } catch let e as APIError {
            formError = e.errorDescription ?? String(localized: "edit_profile.error.save")
            return false
        } catch {
            formError = error.localizedDescription
            return false
        }
    }
}
