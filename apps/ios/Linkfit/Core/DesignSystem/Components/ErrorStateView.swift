import SwiftUI

struct ErrorStateView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(DSColor.danger.opacity(0.10))
                    .frame(width: 64, height: 64)
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(DSColor.danger)
            }
            Text("common.error_title")
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
            Text(message)
                .font(DSType.bodyMedium)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
            PrimaryButton(title: "common.retry", icon: "arrow.clockwise", action: retry)
                .frame(maxWidth: 280)
                .padding(.top, DSSpacing.xs)
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .dsSurfaceCard(radius: DSRadius.xl)
        .padding(.horizontal, DSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(format: String(localized: "error.retry_voice_format"), message))
    }
}
