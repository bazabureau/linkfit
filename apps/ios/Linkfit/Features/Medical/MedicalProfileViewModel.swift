import Foundation
import Observation

/// View-model backing `MedicalProfileView` — the optional health info form
/// for the signed-in user. Loads the current profile lazily, exposes
/// editable @observed fields, and submits the diff back via PUT.
///
/// The text fields are kept as plain `String` (empty == unset). On submit
/// the view-model translates `""` to `MedicalProfileUpdate.FieldChange.clear`
/// so the server semantics (`null` clears, omitting leaves as-is) are
/// honored — without forcing the UI into a tri-state widget.
@Observable
@MainActor
final class MedicalProfileViewModel {
    /// Edit-form state. Strings are bound directly to TextFields.
    var bloodType: String = ""
    var allergies: String = ""
    var conditions: String = ""
    var medications: String = ""
    var emergencyContactName: String = ""
    var emergencyContactPhone: String = ""
    var shareWithHosts: Bool = false

    private(set) var isLoading = false
    private(set) var isSubmitting = false
    private(set) var loadError: String?
    private(set) var formError: String?
    /// `true` once a save has succeeded — view shows a "Saved" affirmation.
    private(set) var lastSavedAt: Date?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Pull the current profile. Safe to call on every appear — the server
    /// returns an "empty" envelope when no row exists yet.
    func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let profile = try await apiClient.send(Endpoint<MedicalProfile>.medicalProfile)
            bloodType = profile.blood_type ?? ""
            allergies = profile.allergies ?? ""
            conditions = profile.conditions ?? ""
            medications = profile.medications ?? ""
            emergencyContactName = profile.emergency_contact_name ?? ""
            emergencyContactPhone = profile.emergency_contact_phone ?? ""
            shareWithHosts = profile.share_medical_with_host
            if let ts = profile.updated_at,
               let date = ISO8601DateFormatter().date(from: ts) {
                lastSavedAt = date
            }
        } catch let e as APIError {
            loadError = e.errorDescription ?? String(localized: "medical.error.load_failed")
        } catch {
            loadError = String(localized: "medical.error.load_failed")
        }
    }

    /// Submit the current form values. Returns `true` on success so the
    /// view can show a toast / dismiss. On failure `formError` is populated.
    func save() async -> Bool {
        formError = nil
        isSubmitting = true
        defer { isSubmitting = false }

        let update = MedicalProfileUpdate(
            blood_type: change(bloodType),
            allergies: change(allergies),
            conditions: change(conditions),
            medications: change(medications),
            emergency_contact_name: change(emergencyContactName),
            emergency_contact_phone: change(emergencyContactPhone),
            share_medical_with_host: shareWithHosts,
        )
        do {
            let updated = try await apiClient.send(Endpoint<MedicalProfile>.updateMedicalProfile(update))
            // Reconcile local state with the canonical server view so a
            // trimmed/normalized value (e.g. trailing whitespace stripped)
            // reflects immediately without a second GET.
            bloodType = updated.blood_type ?? ""
            allergies = updated.allergies ?? ""
            conditions = updated.conditions ?? ""
            medications = updated.medications ?? ""
            emergencyContactName = updated.emergency_contact_name ?? ""
            emergencyContactPhone = updated.emergency_contact_phone ?? ""
            shareWithHosts = updated.share_medical_with_host
            lastSavedAt = Date()
            return true
        } catch let e as APIError {
            formError = e.errorDescription ?? String(localized: "medical.error.save_failed")
            return false
        } catch {
            formError = String(localized: "medical.error.save_failed")
            return false
        }
    }

    /// Map a UI string into a 3-state field change. Empty == clear; any
    /// non-empty == set. We never emit `.unchanged` from the form because
    /// the user has already seen and confirmed every field on Save.
    private func change(_ raw: String) -> MedicalProfileUpdate.FieldChange<String> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? .clear : .set(trimmed)
    }
}
