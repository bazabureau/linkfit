import Foundation
import Observation

/// Owns the state of a single `ReportSheet` presentation. Lives only as long
/// as the sheet is visible — never persisted, never shared.
///
/// Failure modes surfaced through `errorMessage`:
///  - `.rateLimited`         → "You've sent too many reports recently."
///  - `.notFound`            → "We couldn't find what you tried to report."
///  - `.validation(message)` → server-side reason on input issues
///  - anything else          → generic copy
@Observable
@MainActor
final class ReportSheetViewModel {
    // MARK: - Inputs (set by the host before presenting)

    let targetKind: ReportTargetKind
    let targetId: String
    /// Optional human-readable label for the thing being reported. Lets the
    /// sheet say "Report Jamie Smith" instead of "Report user".
    let targetDisplayName: String?

    // MARK: - State

    var selectedReason: ReportReason = .spam
    var notes: String = ""
    private(set) var isSubmitting: Bool = false
    private(set) var didSucceed: Bool = false
    private(set) var errorMessage: String?

    // MARK: - Deps

    private let apiClient: APIClient

    init(apiClient: APIClient,
         targetKind: ReportTargetKind,
         targetId: String,
         targetDisplayName: String? = nil) {
        self.apiClient = apiClient
        self.targetKind = targetKind
        self.targetId = targetId
        self.targetDisplayName = targetDisplayName
    }

    /// Server-side cap is 2000; we mirror it here so the UI shows a counter
    /// and doesn't bother the server with a doomed payload.
    static let maxNotesLength = 2000

    var trimmedNotes: String {
        notes.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var canSubmit: Bool {
        !isSubmitting && notes.count <= Self.maxNotesLength
    }

    /// Returns `true` on success so the caller can fire success haptics +
    /// dismiss. On failure the VM holds an `errorMessage` for the caller
    /// to surface; the caller is responsible for the failure haptic.
    @discardableResult
    func submit() async -> Bool {
        guard canSubmit else { return false }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            _ = try await apiClient.send(
                Endpoint<ReportOut>.createReport(
                    targetKind: targetKind,
                    targetId: targetId,
                    reason: selectedReason,
                    notes: trimmedNotes.isEmpty ? nil : trimmedNotes
                )
            )
            didSucceed = true
            return true
        } catch let error as APIError {
            errorMessage = Self.message(for: error)
            return false
        } catch is CancellationError {
            // User dismissed mid-flight; don't surface noise.
            return false
        } catch {
            errorMessage = String(localized: "reports.error.generic")
            return false
        }
    }

    private static func message(for error: APIError) -> String {
        switch error {
        case .rateLimited:
            return String(localized: "reports.error.rate_limited")
        case .notFound:
            return String(localized: "reports.error.not_found")
        case .unauthorized:
            return String(localized: "reports.error.unauthorized")
        case .validation(let message), .conflict(let message):
            return message
        case .offline:
            return String(localized: "reports.error.offline")
        default:
            return error.localizedDescription
        }
    }
}
