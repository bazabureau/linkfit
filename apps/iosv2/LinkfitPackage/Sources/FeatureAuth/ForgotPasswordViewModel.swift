import Foundation
import Observation
import Networking

@MainActor
@Observable
public final class ForgotPasswordViewModel {
    public var email = ""
    public var isSubmitting = false
    public var sent = false
    public var errorMessage: String?

    private let repository: any AuthRepository

    public init(repository: any AuthRepository) {
        self.repository = repository
    }

    public var canSubmit: Bool {
        AuthValidation.isValidEmail(email) && !isSubmitting
    }

    public func submit() async {
        guard canSubmit else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            try await repository.requestPasswordReset(email: email.trimmedValue)
            sent = true  // backend is anti-enumeration: always succeeds
        } catch let api as APIError {
            errorMessage = api.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
