import SwiftUI

/// Standard empty state: a muted icon circle, a message, and (optionally) a pill
/// CTA that offers the next useful action. Compact — never a full-screen widget.
public struct EmptyStateView: View {
    private let icon: String
    private let title: LocalizedStringKey
    private let message: LocalizedStringKey?
    private let actionTitle: LocalizedStringKey?
    private let action: (() -> Void)?

    public init(
        icon: String,
        title: LocalizedStringKey,
        message: LocalizedStringKey? = nil,
        actionTitle: LocalizedStringKey? = nil,
        action: (() -> Void)? = nil
    ) {
        self.icon = icon
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        VStack(spacing: DSSpacing.l) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 64, height: 64)
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }

            VStack(spacing: DSSpacing.xs) {
                Text(title)
                    .font(DSFont.cardTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                if let message {
                    Text(message)
                        .font(DSFont.callout)
                        .foregroundStyle(DSColor.textMuted)
                        .multilineTextAlignment(.center)
                }
            }

            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(DSFont.button)
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, DSSpacing.xxl)
                        .padding(.vertical, DSSpacing.m)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(PressableButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DSSpacing.huge)
        .padding(.horizontal, DSSpacing.xl)
    }
}

#Preview {
    EmptyStateView(
        icon: "figure.tennis",
        title: "No games near you yet",
        message: "Be the first to start a game in your area.",
        actionTitle: "Create a game",
        action: {}
    )
    .background(DSColor.canvas)
}
