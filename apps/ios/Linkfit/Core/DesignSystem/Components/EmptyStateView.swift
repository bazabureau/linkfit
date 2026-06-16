import SwiftUI

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: DSSpacing.md) {
            // Icon + title + message read as one VoiceOver element; the CTA
            // below stays a separate, activatable element (combining it here
            // would swallow the button so VoiceOver couldn't trigger it).
            VStack(spacing: DSSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(DSColor.textSecondary)
                Text(title)
                    .font(DSType.title)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .accessibilityElement(children: .combine)
            if let actionTitle, let action {
                PrimaryButton(title: actionTitle, action: action)
                    .padding(.top, DSSpacing.xs)
                    .frame(maxWidth: 280)
            }
        }
        .padding(DSSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
