import Foundation
import SwiftUI

/// Global toast / snackbar controller.
///
/// Views call `ToastCenter.shared.success("Saved")` (or `.error` / `.info`)
/// from anywhere on the main actor and a single bottom-anchored toast slides
/// up over the entire app. The host modifier — `.toastHost()` — observes
/// `current` and renders the active toast; on `nil` it shows nothing.
///
/// Auto-dismiss is driven by a per-toast `Task` keyed on `id`, so requesting
/// a new toast while one is still on screen replaces it cleanly (and the
/// outgoing task is cancelled rather than firing a delayed `current = nil`
/// that would erase the new toast).
///
/// Mirrors the `@Observable` + `@MainActor` pattern used by
/// `ThemeManager` / `LanguageManager` so SwiftUI picks up changes without
/// any `@Published` shim.
///
/// ## Error-with-retry (Wave-10)
/// `errorWithRetry(message:retry:)` shows an error pill with an inline
/// "Yenidən cəhd et" action — purposely top-anchored and longer-lived
/// (8s default) so the user has time to read and tap before it slides
/// away. Tapping retry dismisses the toast and awaits the user's closure
/// on the main actor.
@Observable
@MainActor
final class ToastCenter {

    // Singleton — toasts are inherently UI-global; injecting a per-scene
    // instance would mean every feature has to thread an environment
    // object just to fire-and-forget a confirmation message.
    static let shared = ToastCenter()

    /// The toast currently on screen (or queued to slide in). `nil` when
    /// nothing is showing. `ToastHost` re-renders whenever this changes.
    private(set) var current: Toast?

    /// Pending dismissal. Held so a follow-up toast can cancel the
    /// previous one's auto-dismiss before it clears the new toast.
    private var dismissTask: Task<Void, Never>?

    private init() {}

    // MARK: - Public API

    func success(_ message: String, duration: TimeInterval = 3) {
        show(Toast(kind: .success, message: message), duration: duration)
    }

    func error(_ message: String, duration: TimeInterval = 4) {
        show(Toast(kind: .error, message: message), duration: duration)
    }

    func info(_ message: String, duration: TimeInterval = 3) {
        show(Toast(kind: .info, message: message), duration: duration)
    }

    /// Show a red-tinted error pill with an inline retry button. The
    /// toast auto-dismisses after `duration` (default 8s — longer than a
    /// plain `.error` so the user can actually read and tap) OR the
    /// instant the user taps "Yenidən cəhd et", whichever comes first.
    ///
    /// The retry closure runs on the main actor after the toast clears,
    /// so VMs can safely mutate UI state from inside it without an extra
    /// `await MainActor.run`.
    ///
    /// `message` is presented verbatim — callers pass the already-
    /// localized copy (typically `APIError.localizedMessage` or one of the
    /// `error.*` xcstrings keys).
    func errorWithRetry(
        message: String,
        duration: TimeInterval = 8,
        retry: @escaping @MainActor () async -> Void
    ) {
        show(
            Toast(kind: .errorWithRetry(retry: retry), message: message),
            duration: duration
        )
    }

    /// Dismiss whatever toast is on screen, immediately. Safe to call when
    /// nothing is showing.
    func dismiss() {
        dismissTask?.cancel()
        dismissTask = nil
        current = nil
    }

    /// Invoke the current toast's retry action and dismiss the pill.
    /// Routed through here (instead of the view calling the closure
    /// directly) so the auto-dismiss task is cancelled and only one
    /// retry can fire per pill — a frustrated double-tap doesn't kick
    /// off two parallel loads.
    func performRetry() {
        guard let toast = current,
              case .errorWithRetry(let action) = toast.kind else { return }
        dismiss()
        Task { @MainActor in await action() }
    }

    // MARK: - Internals

    private func show(_ toast: Toast, duration: TimeInterval) {
        // Cancel any in-flight auto-dismiss before swapping `current`,
        // otherwise the previous toast's timer would fire and erase the
        // new toast partway through its lifetime.
        dismissTask?.cancel()
        current = toast

        let id = toast.id
        dismissTask = Task { [weak self] in
            // `Task.sleep` throws on cancellation — swallow it; cancellation
            // is the expected outcome when a newer toast replaces this one.
            try? await Task.sleep(nanoseconds: UInt64(max(duration, 0) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            guard let self else { return }
            // Only clear if we're still the active toast. A concurrent
            // `show(_:)` could have raced past the cancellation check on
            // some scheduling paths.
            if self.current?.id == id {
                self.current = nil
            }
        }
    }
}

/// A single toast payload. `Identifiable` so SwiftUI can key transitions
/// off `id` when `current` swaps between toasts.
///
/// Note on `Equatable`: the retry-closure variant is intentionally NOT
/// `Equatable` (closures aren't), so we removed the protocol conformance
/// in Wave-10. Callers that previously relied on `Toast` equality have
/// been migrated to compare `id`s instead — see `ToastHost`.
struct Toast: Identifiable {
    let id: UUID
    let kind: Kind
    let message: String
    let createdAt: Date

    init(
        id: UUID = UUID(),
        kind: Kind,
        message: String,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.kind = kind
        self.message = message
        self.createdAt = createdAt
    }

    /// Visual flavor for the pill. `.errorWithRetry` carries the retry
    /// closure inline so `ToastView` can render the action button without
    /// reaching back into `ToastCenter` to look it up.
    enum Kind {
        case success
        case error
        case info
        case errorWithRetry(retry: @MainActor () async -> Void)
    }
}
