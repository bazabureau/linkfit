import SwiftUI

struct LoadingView: View {
    var label: String? = nil

    var body: some View {
        VStack(spacing: DSSpacing.sm) {
            ProgressView()
                .controlSize(.large)
                .tint(DSColor.accent)
            if let label {
                Text(label)
                    .font(DSType.footnote)
                .foregroundStyle(DSColor.textSecondary)
            }
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .accessibilityLabel(label ?? String(localized: "loading.default"))
    }
}
