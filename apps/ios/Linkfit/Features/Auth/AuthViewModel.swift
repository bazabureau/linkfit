import Foundation
import Observation

enum AuthMode { case login, register }

@Observable
@MainActor
final class AuthViewModel {
    var email: String = ""
    var password: String = ""
    var displayName: String = ""
    /// Default to 25 years ago so the user lands on a likely-correct decade
    /// instead of today's date.
    var birthDate: Date = Calendar.current.date(byAdding: .year, value: -25, to: Date())
        ?? Date()
    var rememberMe: Bool = true

    var emailError: String?
    var passwordError: String?
    var displayNameError: String?
    var birthDateError: String?
    var formError: String?
    var isSubmitting: Bool = false

    private let apiClient: APIClient
    private let container: AppContainer

    init(apiClient: APIClient, container: AppContainer) {
        self.apiClient = apiClient
        self.container = container
    }

    var canSubmit: Bool {
        let baseOK = !email.trimmingCharacters(in: .whitespaces).isEmpty &&
                     password.count >= 6 &&
                     !isSubmitting
        return baseOK
    }

    func submit(mode: AuthMode) async {
        emailError = isValidEmail(email) ? nil : String(localized: "auth.error.invalid_email")
        passwordError = (mode == .register && !isValidRegistrationPassword(password))
            ? String(localized: "auth.error.password_too_short")
            : nil
        displayNameError = mode == .register && displayName.trimmingCharacters(in: .whitespaces).isEmpty
            ? String(localized: "auth.error.no_display_name")
            : nil
        birthDateError = (mode == .register && !isReasonableBirthDate(birthDate))
            ? String(localized: "auth.error.invalid_birth_date")
            : nil
        formError = nil
        if emailError != nil || passwordError != nil || displayNameError != nil || birthDateError != nil {
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let session: AuthSession
            switch mode {
            case .login:
                session = try await apiClient.send(.login(
                    email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                    password: password
                ))
            case .register:
                session = try await apiClient.send(.register(
                    email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                    password: password,
                    displayName: displayName.trimmingCharacters(in: .whitespaces),
                    birthDate: birthDateString(birthDate)
                ))
            }
            container.setSession(session)
            // Analytics — wave-10 product-funnel taxonomy. The
            // `signup_completed` event fires exactly once per registered
            // user, on the registration branch only (login does NOT
            // emit). `locale` is the LanguageManager-selected language
            // code so the dashboard can stack-rank market growth;
            // `referral_code_used` is a placeholder false today — the
            // referral entry point lives elsewhere and will plug into
            // this property once the code-capture path is wired into
            // `AuthViewModel`. The OAuth flows below do not emit this
            // event today because the brief specifies password
            // registration as the signal source.
            if mode == .register {
                Analytics.track(.signupCompleted(
                    locale: Locale.current.identifier,
                    referralCodeUsed: false
                ))
            }
        } catch let error as APIError {
            formError = error.localizedMessage
        } catch {
            formError = error.localizedDescription
        }
    }

    private func isValidEmail(_ s: String) -> Bool {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        let regex = #/^[^@\s]+@[^@\s]+\.[^@\s]+$/#
        return trimmed.wholeMatch(of: regex) != nil
    }

    private func isReasonableBirthDate(_ d: Date) -> Bool {
        guard let oldest = Calendar.current.date(byAdding: .year, value: -120, to: Date()),
              let youngest = Calendar.current.date(byAdding: .year, value: -10, to: Date())
        else { return true }
        return d >= oldest && d <= youngest
    }

    func isValidRegistrationPassword(_ value: String) -> Bool {
        value.count >= 12 &&
        value.rangeOfCharacter(from: .letters) != nil &&
        value.rangeOfCharacter(from: .decimalDigits) != nil
    }

    private func birthDateString(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    // MARK: - OAuth (Apple + Google) — appended by OAuth agent

    /// Run the Sign in with Apple flow and, on success, hand the resulting
    /// session to the container exactly the same way email/password does.
    /// User-initiated cancellations are swallowed silently — only real
    /// failures bubble up into `formError`.
    ///
    /// Network failures are surfaced with the localized "no internet" copy
    /// instead of the raw `NSURLError` description so the toast reads cleanly
    /// in all three supported languages.
    func signInWithApple() async {
        formError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let service = AppleSignInService(apiClient: apiClient)
            let session = try await service.signIn()
            container.setSession(session)
        } catch AppleSignInError.canceled {
            // user dismissed the sheet — no toast
        } catch AppleSignInError.networkOffline {
            formError = String(localized: "error.network_offline")
        } catch let error as AppleSignInError {
            formError = error.errorDescription
        } catch let error as APIError {
            formError = error.localizedMessage
        } catch {
            formError = error.localizedDescription
        }
    }

    /// Run the Google Sign-In flow and, on success, hand the resulting
    /// session to the container.
    ///
    /// Mirrors the Apple flow for network-failure copy — the Google system
    /// sheet itself can fail offline, and so can the backend exchange.
    func signInWithGoogle() async {
        formError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let service = GoogleSignInService(apiClient: apiClient)
            let session = try await service.signIn()
            container.setSession(session)
        } catch GoogleSignInError.canceled {
            // user dismissed the sheet — no toast
        } catch GoogleSignInError.networkOffline {
            formError = String(localized: "error.network_offline")
        } catch let error as GoogleSignInError {
            formError = error.errorDescription
        } catch let error as APIError {
            formError = error.localizedMessage
        } catch {
            formError = error.localizedDescription
        }
    }
}
