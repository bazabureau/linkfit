import SwiftUI

/// Reusable 26-week heatmap. Renders one cell per `StreaksWeek` in a
/// horizontally-laid-out grid of 13 columns × 2 rows (top row = older,
/// bottom row = more recent). Lime gradient saturates from translucent to
/// solid based on the games-count tier; zero-count cells are grey so empty
/// weeks read as gaps, not noise.
///
/// Embeddable in any container — ProfileView drops it into a `Card` to
/// surface the "active player" signal without leaving the profile screen.
struct StreaksHeatmap: View {
    let weeks: [StreaksWeek]
    /// Cell side length. The default sizes for a 360-pt-wide phone (13 cells
    /// + 12 gaps ≈ 320 pt of content). Callers can shrink for tight slots
    /// (e.g. ProfileView header).
    var cellSize: CGFloat = 18
    /// Spacing between cells. The same value is used between rows so the
    /// grid stays visually square.
    var cellSpacing: CGFloat = 4
    /// Closure fired when the user taps a cell. The hosting view uses this
    /// to drive the floating tooltip overlay.
    var onTap: ((StreaksWeek) -> Void)? = nil
    /// The currently-selected cell, if any — drives the highlight ring.
    var selected: StreaksWeek? = nil

    /// We split the 26-week series into 2 rows of 13 so the heatmap stays
    /// readable on phone widths without scrolling. Older weeks on top, newer
    /// on the bottom — feels like reading a calendar.
    private var rows: [[StreaksWeek]] {
        guard weeks.count >= 2 else { return [weeks] }
        let split = weeks.count / 2
        return [Array(weeks.prefix(split)), Array(weeks.suffix(weeks.count - split))]
    }

    var body: some View {
        VStack(spacing: cellSpacing) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: cellSpacing) {
                    ForEach(row) { week in
                        cell(for: week)
                    }
                }
            }
        }
    }

    private func cell(for week: StreaksWeek) -> some View {
        let isSelected = selected?.week_start == week.week_start
        let isInteractive = onTap != nil
        // The dense 13-per-row grid can't give every swatch a full 44pt frame
        // without overflowing the phone width, so we extend the hit area into
        // the surrounding gap via negative padding inside `contentShape`. The
        // visible swatch and the grid layout are untouched; only the tappable
        // region grows.
        return RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(fillStyle(for: week.games_count))
            .frame(width: cellSize, height: cellSize)
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(
                        isSelected ? DSColor.textPrimary : DSColor.border.opacity(0.3),
                        lineWidth: isSelected ? 1.5 : 0.5,
                    ),
            )
            .contentShape(Rectangle().inset(by: isInteractive ? -cellSpacing : 0))
            .onTapGesture { if isInteractive { onTap?(week) } }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel(for: week))
            .accessibilityAddTraits(isInteractive ? .isButton : [])
    }

    /// Lime gradient tiers — translucent at games=0 (rendered as grey
    /// instead so empty cells don't look like a faded streak), then four
    /// brightness steps as the count rises.
    private func fillStyle(for count: Int) -> AnyShapeStyle {
        if count == 0 {
            return AnyShapeStyle(DSColor.border.opacity(0.35))
        }
        let opacity: Double
        switch count {
        case 1:       opacity = 0.35
        case 2:       opacity = 0.55
        case 3:       opacity = 0.75
        default:      opacity = 1.0
        }
        return AnyShapeStyle(DSColor.accent.opacity(opacity))
    }

    private func accessibilityLabel(for week: StreaksWeek) -> String {
        String(format: String(localized: "streaks.cell.a11y_format"),
               week.week_start, week.games_count)
    }
}
