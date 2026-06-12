import SwiftUI

struct ErrorStateView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: DSSpacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(DSColor.danger)
            Text("common.error_title")
                .font(DSType.title)
                .foregroundStyle(DSColor.textPrimary)
            Text(message)
                .font(DSType.body)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            PrimaryButton(title: String(localized: "common.retry"), icon: "arrow.clockwise", action: retry)
                .frame(maxWidth: 280)
                .padding(.top, DSSpacing.xs)
        }
        .padding(DSSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(format: String(localized: "error.retry_voice_format"), message))
    }
}
