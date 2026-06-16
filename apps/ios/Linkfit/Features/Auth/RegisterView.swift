import SwiftUI

/// Register screen — sister to LoginView with the same visual language
/// and one extra field (display name) + the birth-date picker.
///
/// Strategy choice: Social CTAs sit at the TOP because the friction-
/// free path matters more for sign-ups than for sign-ins. If the user
/// has Apple/Google ready, we never want them to type an email.
struct RegisterView: View {
    @State var viewModel: AuthViewModel
    var onSwitchToLogin: () -> Void

    @State private var heroVisible = false
    @State private var socialVisible = false
    @State private var formVisible = false
    @State private var footerVisible = false

    private var dobRange: ClosedRange<Date> {
        let cal = Calendar.current
        let oldest = cal.date(byAdding: .year, value: -100, to: Date()) ?? Date()
        let youngest = cal.date(byAdding: .year, value: -10, to: Date()) ?? Date()
        return oldest...youngest
    }

    private var canRegister: Bool {
        !viewModel.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !viewModel.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        viewModel.isValidRegistrationPassword(viewModel.password) &&
        !viewModel.isSubmitting
    }

    var body: some View {
        ZStack {
            PremiumAuthBackground()

            ScrollView {
                VStack(spacing: 24) {
                    topBar
                    hero
                    socialBlock
                    divider
                    formBlock
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
                Text("auth.register.title")
                    .font(.system(size: 28, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text("auth.register.subtitle")
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
                .font(.system(size: 12, weight: .semibold, design: .default))
                .foregroundStyle(DSColor.textTertiary)
            Rectangle()
                .fill(DSColor.border.opacity(0.55))
                .frame(height: 1)
        }
        .padding(.vertical, 2)
        .opacity(formVisible ? 1 : 0)
    }

    private var formBlock: some View {
        VStack(spacing: 14) {
            FloatingTextField(
                labelKey: "auth.display_name",
                icon: "person.fill",
                text: $viewModel.displayName,
                contentType: .name,
                autocapitalization: .words,
                errorMessage: viewModel.displayNameError
            )

            FloatingTextField(
                labelKey: "auth.email",
                icon: "envelope.fill",
                text: $viewModel.email,
                keyboard: .emailAddress,
                contentType: .emailAddress,
                errorMessage: viewModel.emailError
            )

            birthDateField

            FloatingTextField(
                labelKey: "auth.password",
                icon: "lock.fill",
                text: $viewModel.password,
                contentType: .newPassword,
                isSecure: true,
                errorMessage: viewModel.passwordError
            )

            // Password guidance is ALWAYS visible: when empty we show the
            // static policy line so the rule is known before typing (and the
            // disabled CTA has a stated reason); once typing begins, the
            // 3-segment strength meter takes over. The policy never hides.
            if viewModel.password.isEmpty {
                passwordPolicyHint
                    .transition(.opacity)
            } else {
                passwordStrength
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            if let formError = viewModel.formError {
                inlineError(formError)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: viewModel.password.isEmpty)
        .opacity(formVisible ? 1 : 0)
        .offset(y: formVisible ? 0 : 12)
    }

    /// Date picker rendered to match FloatingTextField's chrome: same
    /// height, same radius, same border treatment. Birth date is one of
    /// those fields where a wheel/inline picker is much better than a
    /// freeform "DD/MM/YYYY" text input.
    private var birthDateField: some View {
        HStack(spacing: 12) {
            Image(systemName: "calendar")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(DSColor.textTertiary)
                .frame(width: 22)

            Text("auth.birth_date")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(DSColor.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)

            DatePicker(
                "",
                selection: $viewModel.birthDate,
                in: dobRange,
                displayedComponents: [.date]
            )
            .labelsHidden()
            .tint(DSColor.accent)
            .accessibilityLabel(Text("auth.birth_date"))
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.surfaceElevated.opacity(0.72))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    viewModel.birthDateError == nil
                        ? DSColor.border.opacity(0.5)
                        : DSColor.danger,
                    lineWidth: 1
                )
        )
    }

    /// 3-segment strength bar that fills as the password meets each
    /// policy rung (length, mixed case + digit, special character).
    /// Resets to empty when the field is empty.
    private var passwordStrength: some View {
        let level = passwordStrengthLevel
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(0..<3) { i in
                    Capsule(style: .continuous)
                        .fill(i < level ? strengthColor(level) : DSColor.border.opacity(0.5))
                        .frame(height: 4)
                }
            }
            HStack(spacing: 6) {
                Image(systemName: level == 3 ? "checkmark.seal.fill" : "info.circle")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(level == 3 ? DSColor.success : DSColor.textTertiary)
                Text(strengthLabel(level))
                    .font(.system(.caption, design: .default, weight: .medium))
                    .foregroundStyle(level == 3 ? DSColor.success : DSColor.textSecondary)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, -DSSpacing.xs)
        .animation(.easeInOut(duration: 0.22), value: level)
    }

    /// Static policy line shown under the empty password field. It states
    /// the rule up front (so the user knows it before typing) and gives the
    /// disabled Sign-up button a visible reason to be off. Once typing
    /// begins, `passwordStrength` replaces this with the live meter.
    private var passwordPolicyHint: some View {
        HStack(spacing: 6) {
            Image(systemName: "info.circle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
            Text("auth.password.policy")
                .font(.system(.caption, design: .default, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
        .padding(.top, -DSSpacing.xs)
    }

    private var primaryCTA: some View {
        PrimaryAuthButton(
            titleKey: "auth.signup",
            isLoading: viewModel.isSubmitting,
            isEnabled: canRegister
        ) {
            Task { await viewModel.submit(mode: .register) }
        }
        .opacity(formVisible ? 1 : 0)
    }

    private var footerLink: some View {
        HStack(spacing: 6) {
            Text("auth.have_account")
                .foregroundStyle(DSColor.textSecondary)
            Button(action: {
                Haptics.soft()
                onSwitchToLogin()
            }) {
                Text("auth.signin")
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

    // ── Helpers ──────────────────────────────────────────────────

    /// 0 (empty) → 3 (strong). The meter never shows "medium"/"strong"
    /// until the password actually satisfies the registration policy
    /// (>= 12 chars + letter + digit) — i.e. the rung where the CTA
    /// becomes tappable. Anything below the real minimum reads "weak",
    /// so the meter and the button can never disagree.
    private var passwordStrengthLevel: Int {
        let p = viewModel.password
        if p.isEmpty { return 0 }
        // Below the real minimum policy → always weak; never imply acceptance.
        guard viewModel.isValidRegistrationPassword(p) else { return 1 }
        let hasUpper = p.range(of: "[A-Z]", options: .regularExpression) != nil
        let hasLower = p.range(of: "[a-z]", options: .regularExpression) != nil
        let hasSymbol = p.range(of: "[^A-Za-z0-9]", options: .regularExpression) != nil
        // Valid → at least "medium"; mixed-case + length/symbol → "strong".
        return (hasUpper && hasLower && (p.count >= 16 || hasSymbol)) ? 3 : 2
    }

    private func strengthColor(_ level: Int) -> Color {
        switch level {
        case 1: return DSColor.danger
        case 2: return DSColor.warning
        default: return DSColor.success
        }
    }

    private func strengthLabel(_ level: Int) -> LocalizedStringKey {
        switch level {
        case 0: return "auth.password.policy"
        case 1: return "auth.password.weak"
        case 2: return "auth.password.medium"
        default: return "auth.password.strong"
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
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(DSColor.danger.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(DSColor.danger.opacity(0.30), lineWidth: 1)
        )
    }

    private func stagger() {
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
}
