import Foundation
import Observation
import SwiftUI

/// Shared view-model for the verification banner + Enter-Token sheet.
/// Owns network state for the "resend verification email" action and the
/// "submit token" action. Pure SwiftUI state — no global side-effects.
@Observable
@MainActor
final class EmailVerificationViewModel {

    /// Surface used by the banner / sheet to render a toast after each
    /// network call. The view observes `lastResendFeedback` and triggers
    /// an `EmailVerificationToast` whenever it transitions to non-nil.
    struct Feedback: Equatable {
        let kind: EmailVerificationToast.Kind
        let titleKey: LocalizedStringKey
        let messageKey: LocalizedStringKey?
    }

    private(set) var isSending: Bool = false
    private(set) var isSubmitting: Bool = false
    private(set) var lastResendFeedback: Feedback?
    private(set) var lastSubmitFeedback: Feedback?

    /// Seconds remaining on the server's 60-second resend cool-down. `0`
    /// means the resend action is available. The view observes this to show
    /// a "Resend in 0:NN" countdown and disable the button while it ticks.
    private(set) var secondsUntilResend: Int = 0

    /// Server-enforced cool-down window, in seconds.
    private static let resendCooldownSeconds = 60

    /// Drives the per-second decrement of `secondsUntilResend`. Owned here so
    /// it survives view redraws and is cancelled cleanly on deinit / restart.
    private var cooldownTask: Task<Void, Never>?

    /// `true` while the resend action is allowed (no sending in flight and no
    /// active cool-down). The view should gate the resend button on this.
    var canResend: Bool { !isSending && secondsUntilResend == 0 }

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // No deinit cancel: the countdown Task captures `[weak self]` and returns
    // once self deallocates, so it self-cleans. A deinit can't touch the
    // @MainActor-isolated `cooldownTask` anyway.

    /// Re-send the magic-link verification email. The backend enforces a
    /// 60-second cool-down; we surface that to the user as an info toast
    /// rather than an error.
    func resendVerification() async {
        // Don't fire while a request is in flight or the cool-down is ticking —
        // the request would only bounce off the server's RATE_LIMITED guard.
        guard canResend else { return }
        isSending = true
        defer { isSending = false }
        do {
            let result: SendVerificationResponse = try await apiClient.send(.sendVerification)
            if result.sent {
                // A fresh mail went out → start the visible 60s cool-down so
                // the user can't hammer the button before the server allows it.
                startResendCooldown()
                lastResendFeedback = Feedback(kind: .success,
                                              titleKey: "email.toast.resend_success.title",
                                              messageKey: "email.toast.resend_success.message")
            } else {
                lastResendFeedback = Feedback(kind: .info,
                                              titleKey: "email.toast.already_verified.title",
                                              messageKey: "email.toast.already_verified.message")
            }
        } catch let error as APIError {
            // Map RATE_LIMITED to a softer message so the user knows to wait,
            // not that anything is broken.
            if error == APIError.rateLimited {
                // Server says we're still inside the window — mirror it locally
                // so the button shows the countdown instead of staying tappable.
                startResendCooldown()
                lastResendFeedback = Feedback(kind: .info,
                                              titleKey: "email.toast.resend_cooldown.title",
                                              messageKey: "email.toast.resend_cooldown.message")
            } else {
                lastResendFeedback = Feedback(kind: .error,
                                              titleKey: "email.toast.resend_failed.title",
                                              messageKey: "email.toast.resend_failed.message")
            }
        } catch {
            lastResendFeedback = Feedback(kind: .error,
                                          titleKey: "email.toast.resend_failed.title",
                                          messageKey: "email.toast.resend_failed.message")
        }
    }

    /// Submit the 6-digit verification code. On success the view dismisses
    /// itself and refreshes the user via the `onVerified` callback. (The
    /// parameter is still named `token` because the API endpoint field is — the
    /// value is now the numeric code.)
    func submitVerification(token: String) async -> Bool {
        let cleaned = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleaned.count == 6, cleaned.allSatisfy(\.isNumber) else {
            lastSubmitFeedback = Feedback(kind: .error,
                                          titleKey: "email.toast.invalid_token.title",
                                          messageKey: "email.toast.invalid_token.message")
            return false
        }
        guard !isSubmitting else { return false }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let result: VerifyEmailResponse = try await apiClient.send(.verifyEmail(token: cleaned))
            if result.verified {
                lastSubmitFeedback = Feedback(kind: .success,
                                              titleKey: "email.toast.verified.title",
                                              messageKey: "email.toast.verified.message")
                return true
            }
            lastSubmitFeedback = Feedback(kind: .error,
                                          titleKey: "email.toast.invalid_token.title",
                                          messageKey: "email.toast.invalid_token.message")
            return false
        } catch {
            lastSubmitFeedback = Feedback(kind: .error,
                                          titleKey: "email.toast.invalid_token.title",
                                          messageKey: "email.toast.invalid_token.message")
            return false
        }
    }

    /// Clear the toast surface so the same feedback message doesn't get
    /// re-shown after a `nil` round-trip.
    func acknowledgeResend() { lastResendFeedback = nil }
    func acknowledgeSubmit() { lastSubmitFeedback = nil }

    // MARK: - Resend cool-down

    /// `secondsUntilResend` rendered as `0:NN` for the button label
    /// (e.g. "Resend in 0:42"). Returns `nil` when no cool-down is active so
    /// the view can fall back to its plain "Resend" label.
    var resendCountdownText: String? {
        guard secondsUntilResend > 0 else { return nil }
        let minutes = secondsUntilResend / 60
        let seconds = secondsUntilResend % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    /// Begin (or restart) the 60-second countdown. Resets the clock to the
    /// full window and ticks `secondsUntilResend` down once per second on the
    /// main actor until it reaches zero or the task is cancelled.
    private func startResendCooldown() {
        cooldownTask?.cancel()
        secondsUntilResend = Self.resendCooldownSeconds
        cooldownTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                guard let self else { return }
                if self.secondsUntilResend <= 1 {
                    self.secondsUntilResend = 0
                    return
                }
                self.secondsUntilResend -= 1
            }
        }
    }
}
