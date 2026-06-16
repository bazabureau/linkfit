import SwiftUI

/// Footer-tier secondary action — "Reserve a court". Sits at the
/// bottom of the home scroll, below all discovery sections, because:
///
///   - Booking a venue is a less frequent action than creating or
///     finding a game (most players join existing games rather than
///     hosting from scratch).
///   - We didn't want a fourth equally-weighted action competing
///     with the primary hero CTAs. A wide single-row chip at the
///     bottom keeps it discoverable without giving it equal billing.
///
/// Visual: glass capsule with calendar icon + label + chevron. The
/// chevron is the universal "this opens something" affordance, which
/// matters here because the action launches a sheet rather than
/// navigating in place.
struct HomeBookCourtChip: View {
    var action: () -> Void

    var body: some View {
        Button(action: tap) {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle()
                        .fill(DSColor.accent.opacity(0.16))
                        .frame(width: 34, height: 34)
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("home.action.book_court")
                        .font(.system(size: 14, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                    Text("home.action.book_court.sub")
                        .font(.system(size: 11, weight: .medium, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        action()
    }
}
