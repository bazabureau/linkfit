import SwiftUI

/// Premium social auth button matching Apple/Google brand guidelines.
///
/// - Apple: solid black with white Apple logo, "Continue with Apple" text.
/// - Google: solid white background with the official 4-color "G" logo and
///   dark text — this is the variant Google's branding spec calls
///   "Continue with Google (light)". The contrast against our dark page
///   makes the button feel like a first-class CTA, not an afterthought.
struct PremiumSocialButton: View {
    enum Provider {
        case apple, google
    }

    let provider: Provider
    let action: () -> Void

    @State private var pressed = false

    var body: some View {
        Button {
            Haptics.soft()
            action()
        } label: {
            HStack(spacing: 12) {
                icon
                Text(labelKey)
                    .font(.system(size: 16, weight: .semibold, design: .default))
                    .foregroundStyle(textColor)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(background)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: 1)
            )
            .scaleEffect(pressed ? 0.98 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.75), value: pressed)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in pressed = true }
                .onEnded { _ in pressed = false }
        )
        .accessibilityLabel(Text(labelKey))
    }

    // MARK: - Provider styling

    @ViewBuilder
    private var icon: some View {
        switch provider {
        case .apple:
            Image(systemName: "apple.logo")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(.white)
        case .google:
            Image("GoogleG")
                .resizable()
                .scaledToFit()
                .frame(width: 20, height: 20)
        }
    }

    private var labelKey: LocalizedStringKey {
        switch provider {
        case .apple:  return "auth.continue_with_apple"
        case .google: return "auth.continue_with_google"
        }
    }

    private var textColor: Color {
        switch provider {
        case .apple:  return .white
        case .google: return Color(red: 0.13, green: 0.13, blue: 0.13)
        }
    }

    @ViewBuilder
    private var background: some View {
        switch provider {
        case .apple:
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black)
        case .google:
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white)
        }
    }

    private var borderColor: Color {
        switch provider {
        case .apple:  return Color.white.opacity(0.10)
        case .google: return Color.black.opacity(0.10)
        }
    }
}
