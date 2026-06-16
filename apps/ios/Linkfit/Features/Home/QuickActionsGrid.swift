import SwiftUI

/// Primary home shortcuts. Kept as a grid so labels stay readable on iPhone.
struct QuickActionsGrid: View {
    let onCreate: () -> Void
    let onFind: () -> Void
    let onTournaments: () -> Void
    let onBook: () -> Void

    private let columns = [
        GridItem(.flexible(), spacing: DSSpacing.sm),
        GridItem(.flexible(), spacing: DSSpacing.sm)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: DSSpacing.sm) {
            tile(icon: "calendar.badge.plus", titleKey: "actions.book_court", action: onBook)
            tile(icon: "magnifyingglass", titleKey: "actions.find_matches", action: onFind)
            tile(icon: "plus.circle", titleKey: "actions.create_match", action: onCreate)
            tile(icon: "trophy", titleKey: "actions.tournaments", action: onTournaments)
        }
    }

    private func tile(icon: String, titleKey: LocalizedStringKey,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .fill(DSColor.accentMuted)
                        .frame(width: 38, height: 38)
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                .accessibilityHidden(true)

                Text(titleKey)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)
            }
            .padding(DSSpacing.sm)
            .frame(minHeight: 72)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(SpringPressStyle())
    }
}
