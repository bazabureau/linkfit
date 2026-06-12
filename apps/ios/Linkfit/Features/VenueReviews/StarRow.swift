import SwiftUI

/// 1..5 star row. Two flavors:
///   * `.small` — pure display (read-only). Used inside list rows and
///     venue cards.
///   * `.large` — tap-to-rate. Used inside the write-review sheet; emits
///     selection-feedback haptics and animates the chosen star with a
///     spring pop so the gesture feels physical.
///
/// We don't ship 32-stop fractional stars because the wire format is an
/// integer 1..5 — anything else would be misleading. For the summary
/// header we render a half-filled star at the boundary based on the
/// 1-decimal `Double` value the backend returns.
struct StarRow: View {
    enum Variant {
        case small
        case large

        var iconSize: CGFloat {
            switch self {
            case .small: return 14
            case .large: return 36
            }
        }
        var spacing: CGFloat {
            switch self {
            case .small: return 2
            case .large: return 8
            }
        }
    }

    /// Read-only rating value. For interactive mode bind `selection` instead.
    var value: Double
    /// When non-nil the row is interactive — tapping a star writes the
    /// new integer rating into the binding.
    var selection: Binding<Int>?
    var variant: Variant = .small
    /// Optional accent override. Defaults to brand lime; the venue card
    /// uses a warm gold for the summary header.
    var tint: Color = DSColor.accent

    var body: some View {
        HStack(spacing: variant.spacing) {
            ForEach(1...5, id: \.self) { index in
                starView(at: index)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("venue_reviews.a11y.rating_\(String(format: "%.1f", value))"))
        .accessibilityValue(Text(String(format: "%.1f", value)))
    }

    @ViewBuilder
    private func starView(at index: Int) -> some View {
        let filled = Double(index) <= value
        let half = !filled && (Double(index) - 0.5) <= value
        let icon = filled ? "star.fill" : (half ? "star.leadinghalf.filled" : "star")

        if let selection {
            Button {
                Haptics.soft()
                withAnimation(.spring(response: 0.28, dampingFraction: 0.55)) {
                    selection.wrappedValue = index
                }
            } label: {
                Image(systemName: index <= selection.wrappedValue ? "star.fill" : "star")
                    .font(.system(size: variant.iconSize, weight: .semibold))
                    .foregroundStyle(index <= selection.wrappedValue ? tint : DSColor.textTertiary)
                    .symbolEffect(.bounce, value: selection.wrappedValue)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("venue_reviews.a11y.star_\(index)"))
        } else {
            Image(systemName: icon)
                .font(.system(size: variant.iconSize, weight: .semibold))
                .foregroundStyle(filled || half ? tint : DSColor.textTertiary)
        }
    }
}
