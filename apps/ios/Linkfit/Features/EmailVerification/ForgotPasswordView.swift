import SwiftUI

/// Step 1 of the password-reset flow — premium auth styling matching
/// LoginView / RegisterView.
///
/// Visual layout:
///   1. PremiumAuthBackground (solid adaptive app canvas)
///   2. Hero: lock icon + heading + supporting line
///   3. FloatingTextField for the email
///   4. PrimaryAuthButton ("Send reset link")
///   5. Subtle footnote explaining the privacy-conscious "we don't tell
///      you whether the email exists" stance.
///
/// API contract is unchanged: `POST /api/v1/auth/request-password-reset`
/// always returns 200 to prevent account enumeration.
struct ForgotPasswordView: View {

    let apiClient: APIClient
    /// Called after a successful request — the caller decides whether to
    /// push the `ResetPasswordView` next, dismiss the navigation, etc.
    var onRequested: ((String) -> Void)?

    @State private var email: String = ""
    @State private var emailError: String?
    @State private var isSubmitting: Bool = false
    @State private var toast: EmailVerificationToast?
    @State private var heroVisible = false
    @State private var formVisible = false
    @State private var footerVisible = false
    @FocusState private var emailFocused: Bool

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    var body: some View {
        ZStack {
            PremiumAuthBackground()

            ScrollView {
                VStack(spacing: 28) {
                    hero
                    formBlock
                    primaryCTA
                    footnote
                }
                .frame(maxWidth: 480)
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 28)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .navigationTitle("email.forgot.title")
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .top) {
            if let toast {
                EmailVerificationToastView(toast: toast) {
                    self.toast = nil
                }
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: toast)
        .onAppear(perform: stagger)
        .task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            emailFocused = true
        }
    }

    // ── Sections ──────────────────────────────────────────────────

    private var hero: some View {
        VStack(spacing: 16) {
            // Branded icon medallion — lime-tinted lock on a glass disc
            // anchors the page even when it's a single short form.
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.18))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.45), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "key.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }

            VStack(spacing: 6) {
                Text("email.forgot.heading")
                    .font(.system(size: 28, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text("email.forgot.subheading")
                    .font(.system(size: 15, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .opacity(heroVisible ? 1 : 0)
        .offset(y: heroVisible ? 0 : 12)
    }

    private var formBlock: some View {
        FloatingTextField(
            labelKey: "auth.email",
            icon: "envelope.fill",
            text: $email,
            keyboard: .emailAddress,
            contentType: .emailAddress,
            errorMessage: emailError
        )
        .focused($emailFocused)
        .opacity(formVisible ? 1 : 0)
        .offset(y: formVisible ? 0 : 12)
    }

    private var primaryCTA: some View {
        PrimaryAuthButton(
            titleKey: "email.forgot.submit",
            isLoading: isSubmitting,
            isEnabled: canSubmit
        ) {
            Task { await submit() }
        }
        .opacity(formVisible ? 1 : 0)
    }

    private var footnote: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
                .padding(.top, 2)
            Text("email.forgot.footnote")
                .font(.system(.footnote, design: .default))
                .foregroundStyle(DSColor.textTertiary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .opacity(footerVisible ? 1 : 0)
    }

    // ── Entrance ──────────────────────────────────────────────────

    private func stagger() {
        let reduce = UIAccessibility.isReduceMotionEnabled
        if reduce {
            heroVisible = true; formVisible = true; footerVisible = true
            return
        }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
            heroVisible = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                formVisible = true
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) {
            withAnimation(.easeOut(duration: 0.3)) {
                footerVisible = true
            }
        }
    }

    // ── Action ────────────────────────────────────────────────────

    private func submit() async {
        emailError = nil
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard isValidEmail(trimmed) else {
            emailError = String(localized: "auth.error.invalid_email")
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            _ = try await apiClient.send(.requestPasswordReset(email: trimmed))
            toast = EmailVerificationToast(
                title: "email.forgot.toast.title",
                message: "email.forgot.toast.message",
                kind: .success,
            )
            onRequested?(trimmed)
        } catch {
            // The API is engineered to never throw here in normal use
            // (always 200), so any failure is a transport-layer problem.
            toast = EmailVerificationToast(
                title: "email.forgot.toast.error.title",
                message: "email.forgot.toast.error.message",
                kind: .error,
            )
        }
    }

    private func isValidEmail(_ s: String) -> Bool {
        let regex = #/^[^@\s]+@[^@\s]+\.[^@\s]+$/#
        return s.wholeMatch(of: regex) != nil
    }
}
