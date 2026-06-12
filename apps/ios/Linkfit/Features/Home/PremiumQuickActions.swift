import SwiftUI

/// 2×2 grid of premium quick-action cards. All four tiles share the
/// brand lime accent — earlier we used four different colours per tile,
/// but on top of the mesh-gradient background they read as visual noise
/// rather than navigation. Unified accent keeps the home page calm and
/// lets the iconography do the differentiation.
///
/// Action layout (fixed):
///   ┌──────────┬──────────┐
///   │  Create  │   Find   │
///   ├──────────┼──────────┤
///   │  Book    │ Tournaments
///   └──────────┴──────────┘
struct PremiumQuickActions: View {
    var onCreate: () -> Void
    var onFind: () -> Void
    var onBookCourt: () -> Void
    var onTournaments: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                actionCard(
                    icon: "plus.circle.fill",
                    titleKey: "home.action.create_game",
                    subtitleKey: "home.action.create_game.sub",
                    action: onCreate
                )
                actionCard(
                    icon: "magnifyingglass",
                    titleKey: "home.action.find_game",
                    subtitleKey: "home.action.find_game.sub",
                    action: onFind
                )
            }
            HStack(spacing: 12) {
                actionCard(
                    icon: "calendar.badge.plus",
                    titleKey: "home.action.book_court",
                    subtitleKey: "home.action.book_court.sub",
                    action: onBookCourt
                )
                actionCard(
                    icon: "trophy.fill",
                    titleKey: "home.action.tournaments",
                    subtitleKey: "home.action.tournaments.sub",
                    action: onTournaments
                )
            }
        }
    }

    private func actionCard(
        icon: String,
        titleKey: LocalizedStringKey,
        subtitleKey: LocalizedStringKey,
        action: @escaping () -> Void
    ) -> some View {
        QuickActionCard(
            icon: icon,
            titleKey: titleKey,
            subtitleKey: subtitleKey,
            action: action
        )
    }
}

/// Individual card — extracted into its own type so the press-state
/// is per-card rather than shared across the grid. Without this, all
/// four tiles would shrink simultaneously on a single tap.
private struct QuickActionCard: View {
    let icon: String
    let titleKey: LocalizedStringKey
    let subtitleKey: LocalizedStringKey
    let action: () -> Void

    @State private var pressed = false

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                ZStack {
                    Circle()
                        .fill(DSColor.accent.opacity(0.18))
                        .frame(width: 38, height: 38)
                    Image(systemName: icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(titleKey)
                        .font(.system(size: 14, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)

                    Text(subtitleKey)
                        .font(.system(size: 11, weight: .medium, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(DSColor.accent.opacity(0.22), lineWidth: 1)
            )
            .scaleEffect(pressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.78), value: pressed)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in pressed = true }
                .onEnded { _ in pressed = false }
        )
    }
}
