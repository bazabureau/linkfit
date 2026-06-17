import SwiftUI

/// Subtle press-scale shared by all CTAs.
public struct PressableButtonStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Primary action — royal-blue capsule with the CTA shadow. One per screen.
public struct PrimaryButton: View {
    private let title: LocalizedStringKey
    private let icon: String?
    private let isLoading: Bool
    private let isEnabled: Bool
    private let action: () -> Void

    public init(
        _ title: LocalizedStringKey,
        icon: String? = nil,
        isLoading: Bool = false,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.isLoading = isLoading
        self.isEnabled = isEnabled
        self.action = action
    }

    public var body: some View {
        Button {
            dsHaptics.medium()
            action()
        } label: {
            ZStack {
                if isLoading {
                    ProgressView().tint(.white)
                } else {
                    HStack(spacing: DSSpacing.s) {
                        if let icon { Image(systemName: icon).font(.system(size: 15, weight: .semibold)) }
                        Text(title).font(DSFont.button)
                    }
                }
            }
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Capsule().fill(DSColor.accent))
        }
        .buttonStyle(PressableButtonStyle())
        .dsCTAShadow()
        .opacity(isEnabled ? 1 : 0.45)
        .disabled(!isEnabled || isLoading)
    }
}

/// Energy accent — lime capsule with dark ink text. Use sparingly.
public struct AccentButton: View {
    private let title: LocalizedStringKey
    private let icon: String?
    private let action: () -> Void

    public init(_ title: LocalizedStringKey, icon: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    public var body: some View {
        Button {
            dsHaptics.light()
            action()
        } label: {
            HStack(spacing: DSSpacing.s) {
                if let icon { Image(systemName: icon).font(.system(size: 15, weight: .semibold)) }
                Text(title).font(DSFont.button)
            }
            .foregroundStyle(DSColor.courtInk)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Capsule().fill(DSColor.lime))
        }
        .buttonStyle(PressableButtonStyle())
    }
}

/// Secondary action — bordered tonal capsule.
public struct SecondaryButton: View {
    private let title: LocalizedStringKey
    private let icon: String?
    private let action: () -> Void

    public init(_ title: LocalizedStringKey, icon: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.action = action
    }

    public var body: some View {
        Button {
            dsHaptics.light()
            action()
        } label: {
            HStack(spacing: DSSpacing.s) {
                if let icon { Image(systemName: icon).font(.system(size: 15, weight: .semibold)) }
                Text(title).font(DSFont.button)
            }
            .foregroundStyle(DSColor.textPrimary)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Capsule().fill(DSColor.surface2))
            .overlay(Capsule().strokeBorder(DSColor.borderStrong, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
    }
}

#Preview {
    VStack(spacing: 14) {
        PrimaryButton("Continue", icon: "arrow.right") {}
        PrimaryButton("Loading", isLoading: true) {}
        AccentButton("Create game", icon: "plus") {}
        SecondaryButton("Cancel") {}
    }
    .padding()
    .background(DSColor.canvas)
}
