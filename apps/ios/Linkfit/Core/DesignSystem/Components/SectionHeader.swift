import SwiftUI

struct SectionHeader: View {
    let title: String
    var action: (() -> Void)? = nil
    var actionLabel: String = String(localized: "common.see_all")

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(DSType.sectionTitle)
                .foregroundStyle(DSColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let action {
                Button(action: action) {
                    HStack(spacing: DSSpacing.xxs) {
                        Text(actionLabel)
                        Image(systemName: "arrow.right")
                            .font(.system(.caption2, design: .default, weight: .bold))
                    }
                    .font(.system(.footnote, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(actionLabel))
            }
        }
    }
}
