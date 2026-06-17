import SwiftUI
import Models
import AppCore
import DesignSystem

/// Dependencies threaded through the auth navigation stack so each screen can
/// build its own view model and the sibling screens.
@MainActor
struct AuthDependencies {
    let repository: any AuthRepository
    let social: SocialAuth
    let onAuthenticated: (User) -> Void
}

/// Wordmark + heading + optional subtitle, centered. Shared by every auth screen.
struct AuthHeader: View {
    let titleKey: LocalizedStringKey
    let subtitleKey: LocalizedStringKey?

    var body: some View {
        VStack(spacing: DSSpacing.sm) {
            LogoWordmark(size: 34)
                .padding(.bottom, DSSpacing.xs)
            Text(titleKey)
                .font(DSFont.hero)
                .foregroundStyle(DSColor.textPrimary)
                .multilineTextAlignment(.center)
            if let subtitleKey {
                Text(subtitleKey)
                    .font(DSFont.body)
                    .foregroundStyle(DSColor.textMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// Apple / Google sign-in buttons, brand-styled.
struct SocialButton: View {
    enum Provider { case apple, google }

    let provider: Provider
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                icon
                Text(title).font(DSFont.button)
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Capsule().fill(background))
            .overlay(Capsule().strokeBorder(border, lineWidth: provider == .google ? 1 : 0))
        }
        .buttonStyle(PressableButtonStyle())
    }

    @ViewBuilder private var icon: some View {
        switch provider {
        case .apple:
            Image(systemName: "apple.logo").font(.system(size: 17, weight: .medium))
        case .google:
            Text("G").font(.system(size: 17, weight: .heavy))
        }
    }

    private var title: LocalizedStringKey { provider == .apple ? "auth.apple" : "auth.google" }
    private var foreground: Color { provider == .apple ? .white : DSColor.textPrimary }
    private var background: Color { provider == .apple ? DSColor.ink : DSColor.card }
    private var border: Color { DSColor.borderStrong }
}

/// "or with email" divider between social and the email form.
struct OrDivider: View {
    var body: some View {
        HStack(spacing: DSSpacing.m) {
            line
            Text("auth.or_email")
                .font(DSFont.caption)
                .foregroundStyle(DSColor.textDim)
            line
        }
    }

    private var line: some View {
        Rectangle().fill(DSColor.border).frame(height: 1)
    }
}

/// Inline form-level error row.
struct AuthErrorBanner: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.circle.fill")
            .font(DSFont.caption)
            .foregroundStyle(DSColor.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .transition(.opacity)
    }
}
