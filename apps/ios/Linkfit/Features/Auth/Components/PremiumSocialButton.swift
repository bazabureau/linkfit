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
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(background)
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: 1)
            )
            .shadow(color: DSColor.limeInk.opacity(0.06), radius: 8, y: 3)
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
                .foregroundStyle(DSColor.textOnAccent)
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

    // Brand-mandated constants (Apple = black fill / white mark,
    // Google = white fill / dark ink) expressed through the design
    // system's non-adaptive ink/contrast tokens.
    private var textColor: Color {
        switch provider {
        case .apple:  return DSColor.textOnAccent
        case .google: return DSColor.limeInk
        }
    }

    @ViewBuilder
    private var background: some View {
        switch provider {
        case .apple:
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DSColor.limeInk)
        case .google:
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DSColor.textOnAccent)
        }
    }

    private var borderColor: Color {
        switch provider {
        case .apple:  return DSColor.textOnAccent.opacity(0.10)
        // Google is a white pill — on the light canvas it needs a real
        // hairline or it dissolves into the page.
        case .google: return DSColor.border
        }
    }
}
