import Foundation
import Observation

/// Owns the state of the Privacy / GDPR hub:
///
/// 1. Data-export pipeline — POST then poll GET every 5 s until the worker
///    flips status to `ready`. The polling task is owned here (not in the
///    view) so a backgrounded screen doesn't leak the loop and so the
///    same record survives a view re-render.
///
/// 2. Account-deletion state — single GET on appear, then mutations
///    flow through the `schedule` / `cancel` actions. We don't poll
///    deletion because the relevant state transitions are user-driven
///    (scheduled / cancelled) and `hard_delete_at` is days out.
///
/// Errors surface as inline strings (`exportError`, `deletionError`) so
/// the view can decide whether to render an alert, an inline banner, or
/// nothing at all — we deliberately don't push to a global toast surface
/// from a settings sub-screen.
@Observable
@MainActor
final class PrivacyViewModel {

    // MARK: - Data export

    /// Most recent export record returned by the server. `nil` means the
    /// user has never requested one (or the last record was pruned).
    private(set) var export: DataExportRequest?
    /// True while the initial POST is in flight, OR while the poller is
    /// still waiting for a `pending` → `ready` transition. Drives the
    /// "Requesting export…" spinner row.
    private(set) var exportInFlight: Bool = false
    /// One-shot error message; cleared by `clearExportError()` when the
    /// dismiss alert button is tapped.
    private(set) var exportError: String?

    // MARK: - Account deletion

    /// Pending deletion record, or `nil` when the account is not
    /// scheduled for deletion. Status==`cancelled` is also surfaced as
    /// `nil` for the UI — once cancelled there's nothing to act on.
    private(set) var deletion: AccountDeletionRequest?
    /// True while the schedule / cancel mutation is in flight, so the
    /// view can disable the buttons and show a spinner.
    private(set) var deletionInFlight: Bool = false
    private(set) var deletionError: String?

    // MARK: - Deps

    private let apiClient: APIClient
    private var pollTask: Task<Void, Never>?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Lifecycle

    /// Pull the initial state of both sub-systems in parallel so a slow
    /// network on one doesn't gate the other's first paint.
    func load() async {
        async let exp: Void = refreshExport(silent: true)
        async let del: Void = refreshDeletion(silent: true)
        _ = await (exp, del)

        // If we loaded a still-pending export, resume polling — the user
        // may have left the screen while a previous request was in flight.
        if let current = export, current.status == "pending" {
            startPollingExport()
        }
    }

    /// Cancel any background polling. Called from `.task` cancellation
    /// or `.onDisappear` so we never leave a runaway 5 s loop alive
    /// after the screen is gone.
    func tearDown() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: - Data export actions

    /// Kick off a new export request. If there's already a pending one
    /// the server is idempotent — we just resume polling against that
    /// record. On success the poller takes over and flips `exportInFlight`
    /// back to `false` once `ready`.
    func requestExport() async {
        guard !exportInFlight else { return }
        exportError = nil
        exportInFlight = true
        do {
            let result = try await apiClient.send(.requestDataExport())
            self.export = result
            if result.status == "pending" {
                startPollingExport()
            } else {
                // Server returned an already-ready (or failed) record
                // straight out of the gate — no polling needed.
                exportInFlight = false
            }
        } catch let error as APIError {
            exportError = error.errorDescription ?? String(localized: "privacy.export.error")
            exportInFlight = false
        } catch {
            exportError = error.localizedDescription
            exportInFlight = false
        }
    }

    func clearExportError() { exportError = nil }

    private func refreshExport(silent: Bool) async {
        do {
            let result = try await apiClient.send(.dataExportStatus())
            self.export = result
        } catch APIError.notFound {
            // No prior export — treat as "no record yet" rather than an error.
            self.export = nil
        } catch let error as APIError {
            if !silent {
                exportError = error.errorDescription ?? String(localized: "privacy.export.error")
            }
        } catch {
            if !silent {
                exportError = error.localizedDescription
            }
        }
    }

    /// 5 s polling loop. Exits as soon as the record flips out of
    /// `pending` (either `ready` or `failed`) or the task is cancelled.
    /// Always restarts cleanly: if a poll is already in flight we cancel
    /// it first so we never have two loops racing on the same model.
    private func startPollingExport() {
        pollTask?.cancel()
        exportInFlight = true
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 s
                if Task.isCancelled { return }
                // pollExportOnce returns true when the record left the
                // `pending` state, signalling the loop to exit. Doing the
                // status check inside the @MainActor-isolated method
                // avoids needing an `await` on a sync property read.
                let done = await self?.pollExportOnce() ?? true
                if done {
                    self?.finishPolling()
                    return
                }
            }
        }
    }

    /// Returns `true` when the export record has settled (left `pending`).
    private func pollExportOnce() async -> Bool {
        do {
            let result = try await apiClient.send(.dataExportStatus())
            self.export = result
            return result.status != "pending"
        } catch {
            // Transient errors are swallowed — the loop will retry on
            // the next tick. A persistent failure is acceptable because
            // the user can always tap "Request export" again.
            return false
        }
    }

    private func finishPolling() {
        exportInFlight = false
        pollTask = nil
    }

    // MARK: - Account deletion actions

    func scheduleDeletion() async {
        guard !deletionInFlight else { return }
        deletionError = nil
        deletionInFlight = true
        defer { deletionInFlight = false }
        do {
            let result = try await apiClient.send(.scheduleAccountDeletion())
            self.deletion = result
        } catch let error as APIError {
            deletionError = error.errorDescription ?? String(localized: "privacy.delete.error")
        } catch {
            deletionError = error.localizedDescription
        }
    }

    func cancelDeletion() async {
        guard !deletionInFlight else { return }
        deletionError = nil
        deletionInFlight = true
        defer { deletionInFlight = false }
        do {
            _ = try await apiClient.send(Endpoint<EmptyResponse>.cancelAccountDeletion())
            // Server returns 204 — pull the fresh record (which should now
            // be either absent or marked `cancelled`) to drive the UI.
            await refreshDeletion(silent: true)
        } catch let error as APIError {
            deletionError = error.errorDescription ?? String(localized: "privacy.delete.error")
        } catch {
            deletionError = error.localizedDescription
        }
    }

    func clearDeletionError() { deletionError = nil }

    private func refreshDeletion(silent: Bool) async {
        do {
            let result = try await apiClient.send(.accountDeletionStatus())
            // Map a `cancelled`/`completed` record to nil for UI purposes —
            // only `scheduled` is actionable from this screen.
            if let record = result, record.status == "scheduled" {
                self.deletion = record
            } else {
                self.deletion = nil
            }
        } catch APIError.notFound {
            self.deletion = nil
        } catch let error as APIError {
            if !silent {
                deletionError = error.errorDescription ?? String(localized: "privacy.delete.error")
            }
        } catch {
            if !silent {
                deletionError = error.localizedDescription
            }
        }
    }

    // MARK: - Derived view helpers

    /// True iff the user currently has a pending deletion scheduled.
    var hasPendingDeletion: Bool { deletion?.status == "scheduled" }

    /// True iff the latest export is downloadable. We also gate on
    /// `expires_at` if the server populated it — once past, the link
    /// no longer points at a live blob.
    var exportReady: Bool {
        guard let exp = export, exp.status == "ready",
              let _ = exp.download_url else { return false }
        if let expires = exp.expires_at,
           let date = Date.fromISO(expires),
           date < Date() {
            return false
        }
        return true
    }

    /// True iff there's a pending export request still cooking.
    var exportPending: Bool { export?.status == "pending" }

    /// Parsed `download_url` for the ready export. Returns `nil` when
    /// the URL is malformed or the export isn't ready.
    var exportDownloadURL: URL? {
        guard exportReady, let raw = export?.download_url else { return nil }
        return URL(string: raw)
    }

    /// Hard-delete date for the pending deletion, parsed into a
    /// `Date` for `.formatted()`. Falls back to `nil` if the backend
    /// hasn't populated `hard_delete_at` yet.
    var hardDeleteDate: Date? {
        guard let raw = deletion?.hard_delete_at else { return nil }
        return Date.fromISO(raw)
    }
}
