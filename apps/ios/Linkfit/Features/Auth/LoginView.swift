import SwiftUI

/// Login screen — global-startup quality.
///
/// Layout (top → bottom):
///   1. Language picker, hugging the trailing edge of the top bar.
///   2. Brand hero: small logo + headline + supporting line.
///   3. Social CTAs at top of form — "one-tap" is the primary path
///      these days, so it gets the prime real estate.
///   4. "or continue with email" divider.
///   5. Email + password floating-label fields.
///   6. Forgot password + Remember me row.
///   7. Primary action button (lime, full-width).
///   8. Footer link to register.
///
/// Animations: form elements enter on a staggered spring on first appear.
/// Press feedback is haptic + scale; keyboard handling is automatic via
/// `.scrollDismissesKeyboard(.interactively)`.
struct LoginView: View {
    @State var viewModel: AuthViewModel
    var onSwitchToRegister: () -> Void

    @Environment(AppContainer.self) private var container
    @State private var showForgotPassword = false
    @State private var heroVisible = false
    @State private var socialVisible = false
    @State private var formVisible = false
    @State private var footerVisible = false

    var body: some View {
        ZStack {
            PremiumAuthBackground()

            ScrollView {
                VStack(spacing: 24) {
                    topBar
                    hero
                    socialBlock
                    divider
                    emailBlock
                    primaryCTA
                    footerLink
                }
                .frame(maxWidth: 480)
                .padding(.horizontal, 20)
                .padding(.bottom, 28)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaPadding(.top, 8)
        }
        .onAppear(perform: stagger)
        .sheet(isPresented: $showForgotPassword) {
            // PasswordResetFlow owns its own NavigationStack + Cancel
            // toolbar and chains ForgotPassword → ResetPassword (token
            // entry), so a user who forgot their password can actually
            // set a new one instead of dead-ending on the "check your
            // email" toast.
            PasswordResetFlow(apiClient: container.apiClient) { _ in
                showForgotPassword = false
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
    }

    // ── Sections ──────────────────────────────────────────────────

    private var topBar: some View {
        HStack {
            Spacer()
            LanguagePicker()
        }
        .opacity(heroVisible ? 1 : 0)
    }

    private var hero: some View {
        VStack(spacing: 16) {
            LogoWordmark(size: .custom(36))

            VStack(spacing: 6) {
                Text("auth.login.title")
                    .font(DSType.heroTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text("auth.login.subtitle")
                    .font(.system(size: 15, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .opacity(heroVisible ? 1 : 0)
        .offset(y: heroVisible ? 0 : 12)
    }

    private var socialBlock: some View {
        VStack(spacing: 12) {
            PremiumSocialButton(provider: .apple) {
                Task { await viewModel.signInWithApple() }
            }
            PremiumSocialButton(provider: .google) {
                Task { await viewModel.signInWithGoogle() }
            }
        }
        .opacity(socialVisible ? 1 : 0)
        .offset(y: socialVisible ? 0 : 12)
    }

    private var divider: some View {
        HStack(spacing: 12) {
            Rectangle()
                .fill(DSColor.border.opacity(0.55))
                .frame(height: 1)
            Text("auth.or_email")
                .font(DSType.metaCaption)
                .foregroundStyle(DSColor.textTertiary)
            Rectangle()
                .fill(DSColor.border.opacity(0.55))
                .frame(height: 1)
        }
        .padding(.vertical, 2)
        .opacity(formVisible ? 1 : 0)
    }

    private var emailBlock: some View {
        VStack(spacing: 14) {
            FloatingTextField(
                labelKey: "auth.email",
                icon: "envelope.fill",
                text: $viewModel.email,
                keyboard: .emailAddress,
                contentType: .username,
                errorMessage: viewModel.emailError
            )

            FloatingTextField(
                labelKey: "auth.password",
                icon: "lock.fill",
                text: $viewModel.password,
                contentType: .password,
                isSecure: true,
                errorMessage: viewModel.passwordError
            )

            HStack {
                CheckboxRow(labelKey: "auth.remember_me", isOn: $viewModel.rememberMe)
                Spacer(minLength: 0)
                Button { showForgotPassword = true } label: {
                    Text("auth.forgot_password")
                        .font(.system(size: 13, weight: .semibold, design: .default))
                        .foregroundStyle(DSColor.accent)
                }
                .buttonStyle(.plain)
            }

            if let formError = viewModel.formError {
                inlineError(formError)
            }
        }
        .opacity(formVisible ? 1 : 0)
        .offset(y: formVisible ? 0 : 12)
    }

    private var primaryCTA: some View {
        PrimaryAuthButton(
            titleKey: "auth.signin",
            isLoading: viewModel.isSubmitting,
            isEnabled: viewModel.canSubmit
        ) {
            Task { await viewModel.submit(mode: .login) }
        }
        .opacity(formVisible ? 1 : 0)
    }

    private var footerLink: some View {
        HStack(spacing: 6) {
            Text("auth.no_account")
                .foregroundStyle(DSColor.textSecondary)
            Button(action: {
                Haptics.soft()
                onSwitchToRegister()
            }) {
                Text("auth.signup")
                    .fontWeight(.bold)
                    .foregroundStyle(DSColor.accent)
            }
            .buttonStyle(.plain)
        }
        .font(.system(size: 14, design: .default))
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
        .opacity(footerVisible ? 1 : 0)
    }

    // ── Entrance animation ───────────────────────────────────────

    private func stagger() {
        // Reduce Motion users see everything instantly; the spring values
        // already feel soft but skipping the offset removes the moving
        // pixels entirely.
        let reduce = UIAccessibility.isReduceMotionEnabled

        if reduce {
            heroVisible = true; socialVisible = true; formVisible = true; footerVisible = true
            return
        }

        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
            heroVisible = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                socialVisible = true
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                formVisible = true
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
            withAnimation(.easeOut(duration: 0.3)) {
                footerVisible = true
            }
        }
    }

    private func inlineError(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.danger)
            Text(text)
                .font(.system(.footnote, design: .default, weight: .medium))
                .foregroundStyle(DSColor.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.danger.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.danger.opacity(0.30), lineWidth: 1)
        )
    }
}
