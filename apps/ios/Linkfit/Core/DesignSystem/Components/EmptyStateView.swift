import SwiftUI

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: DSSpacing.sm) {
            // Icon + title + message read as one VoiceOver element; the CTA
            // below stays a separate, activatable element (combining it here
            // would swallow the button so VoiceOver couldn't trigger it).
            VStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle()
                        .fill(DSColor.accentMuted)
                        .frame(width: 64, height: 64)
                    Image(systemName: icon)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                Text(title)
                    .font(DSType.sectionTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(DSType.bodyMedium)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
            .accessibilityElement(children: .combine)
            if let actionTitle, let action {
                PrimaryButton(title: actionTitle, action: action)
                    .padding(.top, DSSpacing.xs)
                    .frame(maxWidth: 280)
            }
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .dsSurfaceCard(radius: DSRadius.xl)
        .padding(.horizontal, DSSpacing.md)
    }
}
