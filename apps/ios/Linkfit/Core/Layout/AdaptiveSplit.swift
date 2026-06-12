import SwiftUI

/// Master-detail container that swaps between single-column (iPhone) and
/// two-column (iPad / large landscape phones) layouts based on the horizontal
/// size class.
///
/// ## Behaviour
/// * **Compact width** — renders `master` only, occupying the full available
///   space. Pushing a detail is the host's responsibility (e.g. via the
///   feature's existing `NavigationStack`). The container is transparent.
/// * **Regular width** — renders a 40/60 `HStack`: `master` on the left,
///   `detail` on the right. When `detail` is `nil` we show a lime "Select an
///   item from the left" empty state so the right pane is never blank.
///
/// The container does not own any navigation state — call sites pass a
/// detail builder that produces `nil` when nothing is selected. That keeps
/// every feature's view-model API untouched.
///
/// ```swift
/// AdaptiveSplit(
///     master: { PlayersList(...) },
///     detail: { selectedPlayerID.map { PlayerDetailView(id: $0) } }
/// )
/// ```
struct AdaptiveSplit<Master: View, Detail: View>: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private let master: () -> Master
    private let detail: () -> Detail?

    /// - Parameters:
    ///   - master: The list / primary content. Always shown.
    ///   - detail: Optional detail content. `nil` triggers the empty state
    ///     on regular size class; ignored entirely on compact (the host
    ///     handles push navigation).
    init(
        @ViewBuilder master: @escaping () -> Master,
        @ViewBuilder detail: @escaping () -> Detail?
    ) {
        self.master = master
        self.detail = detail
    }

    var body: some View {
        if LayoutSize.isWideLayout(horizontalSizeClass) {
            // Geometry-driven 40/60 split. We compute concrete widths once
            // at the top so SwiftUI doesn't have to re-resolve a layout
            // priority fight between the two panes on every redraw.
            GeometryReader { geo in
                HStack(spacing: 0) {
                    master()
                        .frame(width: max(0, geo.size.width * 0.40))

                    Divider()
                        .overlay(DSColor.border)

                    Group {
                        if let detailView = detail() {
                            detailView
                        } else {
                            AdaptiveSplitEmptyState()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else {
            master()
        }
    }
}

// MARK: - Empty state

/// Default empty-state shown in the detail pane when nothing is selected.
/// Uses the brand lime accent so it reads as an invitation, not a warning.
private struct AdaptiveSplitEmptyState: View {
    var body: some View {
        ZStack {
            DSColor.background
            VStack(spacing: DSSpacing.md) {
                ZStack {
                    Circle()
                        .fill(DSColor.accentMuted)
                        .frame(width: 80, height: 80)
                    Image(systemName: "hand.point.left.fill")
                        .font(.system(size: 32, weight: .bold))
                        .foregroundStyle(DSColor.accent)
                }
                // Verbatim strings — keeps the helper out of the xcstrings
                // catalog (localization is owned by feature views, not Core).
                Text(verbatim: "Select an item from the left")
                    .font(.system(.title3, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                Text(verbatim: "Tap a row to see its details here.")
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DSSpacing.lg)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
