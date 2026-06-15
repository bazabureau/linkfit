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

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Re-send the magic-link verification email. The backend enforces a
    /// 60-second cool-down; we surface that to the user as an info toast
    /// rather than an error.
    func resendVerification() async {
        guard !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            let result: SendVerificationResponse = try await apiClient.send(.sendVerification)
            lastResendFeedback = result.sent
                ? Feedback(kind: .success,
                           titleKey: "email.toast.resend_success.title",
                           messageKey: "email.toast.resend_success.message")
                : Feedback(kind: .info,
                           titleKey: "email.toast.already_verified.title",
                           messageKey: "email.toast.already_verified.message")
        } catch let error as APIError {
            // Map RATE_LIMITED to a softer message so the user knows to wait,
            // not that anything is broken.
            if error == APIError.rateLimited {
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
}
