import SwiftUI

/// Signature CTA: accent pill with a dark badge on the left holding the brand
/// mark and a subtle tinted badge on the right with the arrow. The royal-blue
/// accent is the dominant action color throughout the app.
struct PillCTA: View {
    let title: String
    var trailingSystemImage: String = "arrow.right"
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: { if isEnabled && !isLoading { action() } }) {
            ZStack {
                Text(title)
                    .font(.system(.body, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textOnAccent)

                HStack {
                    leadingBadge
                    Spacer()
                    trailingBadge
                }
                .padding(.horizontal, 6)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(
                Capsule()
                    .fill(DSColor.accent)
                    .shadow(color: DSColor.accent.opacity(0.35), radius: 18, x: 0, y: 10)
            )
            .opacity(isEnabled ? 1 : 0.55)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isLoading)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }

    private var leadingBadge: some View {
        ZStack {
            Circle().fill(DSColor.inkSurface)
                .frame(width: 52, height: 52)
            BrandMark(size: .custom(28), color: DSColor.accent)
        }
    }

    @ViewBuilder
    private var trailingBadge: some View {
        ZStack {
            Circle()
                .strokeBorder(DSColor.textOnAccent.opacity(0.20), lineWidth: 1.4)
                .background(Circle().fill(DSColor.textOnAccent.opacity(0.10)))
                .frame(width: 52, height: 52)
            if isLoading {
                ProgressView().tint(DSColor.textOnAccent).controlSize(.small)
            } else {
                Image(systemName: trailingSystemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSColor.textOnAccent)
            }
        }
    }
}
