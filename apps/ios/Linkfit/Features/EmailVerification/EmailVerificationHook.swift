import SwiftUI

/// Integration documentation for the Email-verification feature. The
/// agent contract forbids touching `AuthGateView` / `RegisterView` /
/// `LoginView` / `HomeView` / `ProfileView` directly, so this file is the
/// canonical place that describes HOW the surfaces above should pick up
/// the components in this module.
///
/// ─── HomeView / ProfileView ───────────────────────────────────────────
///
///   Mount the banner at the top of the scroll view, just below the
///   navigation bar. The banner self-hides when `currentUser?.email_verified_at`
///   is non-nil, so no extra `if` is required on the host side:
///
///   ```swift
///   if let user = container.currentUser {
///       EmailVerificationBanner(
///           user: user,
///           apiClient: container.apiClient,
///           onVerified: {
///               // Re-fetch /api/v1/me so currentUser.email_verified_at flips.
///               Task { await refreshMe() }
///           }
///       )
///       .padding(.top, DSSpacing.xs)
///   }
///   ```
///
/// ─── AuthGateView ────────────────────────────────────────────────────
///
///   Add a "Forgot password?" link below the password field that pushes
///   `ForgotPasswordView`. On success, push `ResetPasswordView` (the user
///   types the token they just received). On `.reset` completion, pop
///   back to login and present an info toast.
///
///   ```swift
///   NavigationLink {
///       ForgotPasswordView(apiClient: container.apiClient) { _ in
///           // Optionally auto-navigate to ResetPasswordView here.
///       }
///   } label: {
///       Text("auth.forgot_password")
///   }
///   ```
///
/// ─── RegisterView ────────────────────────────────────────────────────
///
///   No code-level integration needed — the API now returns
///   `user.email_verified_at == nil` on register, and the banner shows up
///   automatically inside Home / Profile after the user lands in the app.
///
/// The wrapper view below is exported purely so other features can drop
/// the entire flow into a sheet/full-screen-cover without re-implementing
/// the two-step navigation. It is intentionally NOT mounted anywhere in
/// the app yet — the existing Auth surface stays exactly as it is.
struct PasswordResetFlow: View {

    enum Result { case reset, cancelled }

    let apiClient: APIClient
    var onComplete: (Result) -> Void

    @State private var path: [Step] = []

    private enum Step: Hashable { case reset }

    var body: some View {
        NavigationStack(path: $path) {
            ForgotPasswordView(apiClient: apiClient) { _ in
                path.append(.reset)
            }
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .reset:
                    ResetPasswordView(apiClient: apiClient) { outcome in
                        switch outcome {
                        case .reset:
                            onComplete(.reset)
                        case .cancelled:
                            path.removeAll()
                            onComplete(.cancelled)
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("email.sheet.cancel") { onComplete(.cancelled) }
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
        }
    }
}
