import Foundation
import Observation
import Models
import Networking
import AppCore

@MainActor
@Observable
public final class RegisterViewModel {
    public var name = ""
    public var email = ""
    public var password = ""
    public var isSubmitting = false
    public var errorMessage: String?
    public var nameError: String?
    public var emailError: String?
    public var passwordError: String?

    private let repository: any AuthRepository
    private let social: SocialAuth
    private let onAuthenticated: (User) -> Void

    public init(repository: any AuthRepository, social: SocialAuth, onAuthenticated: @escaping (User) -> Void) {
        self.repository = repository
        self.social = social
        self.onAuthenticated = onAuthenticated
    }

    public var isGoogleAvailable: Bool { social.isGoogleAvailable }

    public var canSubmit: Bool {
        !name.trimmedValue.isEmpty
            && AuthValidation.isValidEmail(email)
            && AuthValidation.isValidPassword(password)
            && !isSubmitting
    }

    public func submit() async {
        guard canSubmit else { return }
        await run {
            try await self.repository.register(
                name: self.name.trimmedValue,
                email: self.email.trimmedValue,
                password: self.password,
                birthDate: nil
            )
        }
    }

    public func appleTapped() async {
        await run { try await self.social.signInWithApple() }
    }

    public func googleTapped() async {
        await run { try await self.social.signInWithGoogle() }
    }

    private func run(_ operation: () async throws -> User) async {
        isSubmitting = true
        errorMessage = nil
        nameError = nil
        emailError = nil
        passwordError = nil
        defer { isSubmitting = false }
        do {
            let user = try await operation()
            onAuthenticated(user)
        } catch let api as APIError {
            applyAPIError(api)
        } catch AppleSignInError.cancelled {
        } catch GoogleAuthError.cancelled {
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func applyAPIError(_ api: APIError) {
        if case .validation(let fields) = api, !fields.isEmpty {
            nameError = fields["display_name"] ?? fields["name"]
            emailError = fields["email"]
            passwordError = fields["password"]
            if nameError == nil && emailError == nil && passwordError == nil { errorMessage = api.userMessage }
        } else {
            errorMessage = api.userMessage
        }
    }
}
