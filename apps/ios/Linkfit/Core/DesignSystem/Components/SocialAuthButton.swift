import SwiftUI

enum SocialProvider {
    case apple, google

    var labelKey: LocalizedStringKey {
        switch self {
        case .apple:  return "auth.continue_with_apple"
        case .google: return "auth.continue_with_google"
        }
    }
}

struct SocialAuthButton: View {
    let provider: SocialProvider
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                icon
                Text(provider.labelKey)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(DSColor.surfaceElevated.opacity(0.48))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(provider.labelKey)
    }

    @ViewBuilder
    private var icon: some View {
        switch provider {
        case .apple:
            Image(systemName: "apple.logo")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
        case .google:
            // Official Google "G" logo per Google Identity branding
            // guidelines. The asset (Assets.xcassets/GoogleG.imageset)
            // is rendered from the SVG paths Google publishes — we do
            // NOT draw our own version because Google's sign-in terms
            // require the original brand mark with its exact 4-color
            // composition (blue/red/yellow/green).
            Image("GoogleG")
                .resizable()
                .scaledToFit()
                .frame(width: 20, height: 20)
        }
    }
}
