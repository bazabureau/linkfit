import SwiftUI

/// Step 2 of the password-reset flow — premium auth styling.
///
/// User pastes the magic-link token from their email and a new password;
/// we call `POST /api/v1/auth/reset-password`. On success, the server
/// revokes all refresh tokens so we route back to login.
///
/// UX details:
///   - The token field accepts the raw token OR the full deep-link URL
///     ("linkfit://reset?token=…"); `extractToken` peels it apart.
///   - 4-bar strength meter tracks the same policy the server enforces:
///     length, mixed case, digit, special char.
///   - Confirm field surfaces the mismatch error inline, not as a toast.
struct ResetPasswordView: View {

    enum CompletionResult { case reset, cancelled }

    let apiClient: APIClient
    var onComplete: (CompletionResult) -> Void

    @State private var token: String = ""
    @State private var password: String = ""
    @State private var passwordConfirm: String = ""
    @State private var isSubmitting: Bool = false
    @State private var formError: String?
    @State private var toast: EmailVerificationToast?
    @State private var heroVisible = false
    @State private var formVisible = false
    @FocusState private var focused: Field?

    private enum Field: Hashable { case token, password, confirm }

    var body: some View {
        ZStack {
            PremiumAuthBackground()

            ScrollView {
                VStack(spacing: 24) {
                    hero
                    tokenInput
                    passwordInput
                    confirmInput
                    strengthMeter
                    primaryCTA
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
        .navigationTitle("email.reset.title")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("email.sheet.cancel") { onComplete(.cancelled) }
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
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
    }

    // ── Sections ──────────────────────────────────────────────────

    private var hero: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.18))
                    .frame(width: 64, height: 64)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.45), lineWidth: 1)
                    .frame(width: 64, height: 64)
                Image(systemName: "lock.rotation")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }

            VStack(spacing: 6) {
                Text("email.reset.heading")
                    .font(.system(size: 28, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text("email.reset.subheading")
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .opacity(heroVisible ? 1 : 0)
        .offset(y: heroVisible ? 0 : 12)
    }

    /// Token is a long random string — we render it in a multi-line
    /// monospace field so paste-from-mail works cleanly even with line
    /// wraps in the email client.
    private var tokenInput: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("email.sheet.token_label")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DSColor.textSecondary)
                .padding(.leading, 4)

            TextField(String(localized: "email.sheet.token_placeholder"),
                      text: $token, axis: .vertical)
                .lineLimit(2...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .focused($focused, equals: .token)
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(DSColor.surfaceElevated.opacity(0.72))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(
                            focused == .token ? DSColor.accent : DSColor.border.opacity(0.5),
                            lineWidth: focused == .token ? 1.5 : 1
                        )
                        .shadow(color: focused == .token ? DSColor.accent.opacity(0.22) : .clear,
                                radius: 10, y: 0)
                )
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(DSColor.textPrimary)
                .tint(DSColor.accent)
                .animation(.spring(response: 0.32, dampingFraction: 0.85), value: focused)
        }
        .opacity(formVisible ? 1 : 0)
        .offset(y: formVisible ? 0 : 12)
    }

    private var passwordInput: some View {
        FloatingTextField(
            labelKey: "email.reset.new_password",
            icon: "lock.fill",
            text: $password,
            contentType: .newPassword,
            isSecure: true
        )
        .opacity(formVisible ? 1 : 0)
        .offset(y: formVisible ? 0 : 12)
    }

    private var confirmInput: some View {
        FloatingTextField(
            labelKey: "email.reset.confirm",
            icon: "checkmark.shield.fill",
            text: $passwordConfirm,
            contentType: .newPassword,
            isSecure: true,
            errorMessage: formError
        )
        .opacity(formVisible ? 1 : 0)
        .offset(y: formVisible ? 0 : 12)
    }

    private var strengthMeter: some View {
        let strength = PasswordStrength.evaluate(password)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(0..<4, id: \.self) { idx in
                    Capsule(style: .continuous)
                        .fill(idx < strength.bars ? strength.color : DSColor.border.opacity(0.5))
                        .frame(height: 4)
                }
            }
            HStack(spacing: 6) {
                Image(systemName: strength.bars >= 4 ? "checkmark.seal.fill" : "info.circle")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(strength.bars >= 4 ? DSColor.success : strength.color)
                Text(strength.labelKey)
                    .font(.system(.caption, design: .default, weight: .medium))
                    .foregroundStyle(strength.bars >= 4 ? DSColor.success : DSColor.textSecondary)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, -8)
        .animation(.easeInOut(duration: 0.22), value: strength.bars)
        .opacity(formVisible ? 1 : 0)
    }

    private var primaryCTA: some View {
        PrimaryAuthButton(
            titleKey: "email.reset.submit",
            isLoading: isSubmitting,
            isEnabled: canSubmit
        ) {
            Task { await submit() }
        }
        .padding(.top, 4)
        .opacity(formVisible ? 1 : 0)
    }

    // ── Helpers ──────────────────────────────────────────────────

    private var canSubmit: Bool {
        !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        password.count >= 12 &&
        password == passwordConfirm &&
        !isSubmitting
    }

    private func stagger() {
        let reduce = UIAccessibility.isReduceMotionEnabled
        if reduce {
            heroVisible = true; formVisible = true
            return
        }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
            heroVisible = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                formVisible = true
            }
        }
    }

    private func submit() async {
        formError = nil
        if password != passwordConfirm {
            formError = String(localized: "email.reset.error.mismatch")
            return
        }
        if password.count < 12 {
            formError = String(localized: "auth.error.password_too_short")
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let cleaned = extractToken(from: token)
            let result: ResetPasswordResponse = try await apiClient.send(
                .resetPassword(token: cleaned, newPassword: password)
            )
            if result.reset {
                toast = EmailVerificationToast(
                    title: "email.reset.toast.success.title",
                    message: "email.reset.toast.success.message",
                    kind: .success,
                )
                // Tiny pause so the user sees the toast before we pop the
                // navigation — the caller usually routes back to login.
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                onComplete(.reset)
            } else {
                toast = EmailVerificationToast(
                    title: "email.reset.toast.error.title",
                    message: "email.reset.toast.error.message",
                    kind: .error,
                )
            }
        } catch let error as APIError {
            switch error {
            case .validation(let message):
                formError = message
            default:
                toast = EmailVerificationToast(
                    title: "email.reset.toast.error.title",
                    message: "email.reset.toast.error.message",
                    kind: .error,
                )
            }
        } catch {
            toast = EmailVerificationToast(
                title: "email.reset.toast.error.title",
                message: "email.reset.toast.error.message",
                kind: .error,
            )
        }
    }

    private func extractToken(from raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("token=") else { return trimmed }
        if let url = URL(string: trimmed),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let token = components.queryItems?.first(where: { $0.name == "token" })?.value {
            return token
        }
        return trimmed
    }
}

/// Very small heuristic strength score used by the reset UI. The same
/// 12-char + letter + digit + no-whitespace policy is enforced on the
/// server; this UI surfaces it visually so users know how to satisfy it.
private struct PasswordStrength {
    let bars: Int
    let labelKey: LocalizedStringKey
    let color: Color

    static func evaluate(_ s: String) -> PasswordStrength {
        if s.isEmpty {
            return PasswordStrength(bars: 0,
                                    labelKey: "email.reset.strength.empty",
                                    color: DSColor.border)
        }
        var score = 0
        if s.count >= 8  { score += 1 }
        if s.count >= 12 { score += 1 }
        if s.range(of: #"[A-Z]"#, options: .regularExpression) != nil { score += 1 }
        if s.range(of: #"\d"#,  options: .regularExpression) != nil { score += 1 }
        if s.range(of: #"[^A-Za-z0-9]"#, options: .regularExpression) != nil { score += 1 }
        let bars = max(1, min(4, score))
        let (key, color): (LocalizedStringKey, Color) = {
            switch bars {
            case 1:  return ("email.reset.strength.weak",   DSColor.danger)
            case 2:  return ("email.reset.strength.fair",   DSColor.warning)
            case 3:  return ("email.reset.strength.good",   DSColor.info)
            default: return ("email.reset.strength.strong", DSColor.success)
            }
        }()
        return PasswordStrength(bars: bars, labelKey: key, color: color)
    }
}
