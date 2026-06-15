import SwiftUI

/// Per-player rating sheet. The user moves through every co-player one at a
/// time and rates them on three axes:
///
///   • outcome    — win / draw / loss (single-select segmented row)
///   • stars      — 1-5 star skill rating (required)
///   • tags       — optional behavior chips (team player, fair play, late…)
///
/// The submit CTA is gated until every co-player has both an outcome AND a
/// star rating. Tags are optional — they're a finer-grained signal layered
/// on top of the required fields and feed `behavior_ok` automatically
/// (any negative tag → behavior_ok = false).
struct RatingFlowView: View {
    @State var viewModel: RatingFlowViewModel
    var onFinished: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(Text("rating.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Haptics.selection()
                        dismiss()
                    } label: {
                        Text("rating.close")
                    }
                    .accessibilityLabel(Text("rating.close"))
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var content: some View {
        if let player = viewModel.currentPlayer {
            ScrollView {
                VStack(spacing: DSSpacing.lg) {
                    progressBar
                    playerCard(player)
                    outcomeSection(player)
                    starsSection(player)
                    tagsSection(player)
                    if let error = viewModel.error {
                        Text(error)
                            .font(DSType.footnote)
                            .foregroundStyle(DSColor.danger)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(DSSpacing.lg)
                .padding(.bottom, DSSpacing.xxl)
            }
            .safeAreaInset(edge: .bottom) { footer(for: player) }
        } else {
            EmptyStateView(
                icon: "checkmark.seal",
                title: String(localized: "rating.empty.title"),
                message: String(localized: "rating.empty.message")
            )
        }
    }

    // MARK: - Pieces

    private var progressBar: some View {
        VStack(spacing: DSSpacing.xxs) {
            ProgressView(value: viewModel.progress)
                .tint(DSColor.accent)
            HStack {
                Text(String(format: String(localized: "rating.player_n_of_m_format"),
                            viewModel.index + 1, viewModel.coplayers.count))
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text("\(Int((viewModel.progress * 100).rounded()))%"))
    }

    private func playerCard(_ player: Participant) -> some View {
        Card(padding: DSSpacing.lg) {
            VStack(spacing: DSSpacing.sm) {
                Circle()
                    .fill(LinearGradient(
                        colors: [DSColor.accent, DSColor.accentSoft],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ))
                    .frame(width: 72, height: 72)
                    .overlay(
                        Text(initials(player.display_name))
                            .font(.system(.title, design: .default, weight: .heavy))
                            .foregroundStyle(DSColor.textOnAccent)
                    )
                Text(player.display_name)
                    .font(DSType.title)
                    .foregroundStyle(DSColor.textPrimary)
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: Outcome

    private func outcomeSection(_ player: Participant) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            sectionTitle("rating.section.outcome")
            HStack(spacing: DSSpacing.xs) {
                outcomeChip(labelKey: "rating.outcome.win", icon: "trophy.fill",
                            color: DSColor.success, outcome: "win",
                            player: player)
                outcomeChip(labelKey: "rating.outcome.draw", icon: "equal.circle",
                            color: DSColor.info, outcome: "draw",
                            player: player)
                outcomeChip(labelKey: "rating.outcome.loss", icon: "arrow.down.circle",
                            color: DSColor.warning, outcome: "loss",
                            player: player)
            }
        }
    }

    private func outcomeChip(labelKey: LocalizedStringKey, icon: String, color: Color,
                             outcome: String, player: Participant) -> some View {
        let selected = viewModel.draft(for: player.user_id).outcome == outcome
        return Button {
            viewModel.setOutcome(outcome)
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(selected ? DSColor.textOnAccent : color)
                Text(labelKey)
                    .font(DSType.caption)
                    .foregroundStyle(selected ? DSColor.textOnAccent : DSColor.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, DSSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md)
                    .fill(selected ? DSColor.accent : DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md)
                    .strokeBorder(selected ? DSColor.accent : DSColor.border,
                                  lineWidth: selected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Stars

    private func starsSection(_ player: Participant) -> some View {
        let current = viewModel.draft(for: player.user_id).stars
        return VStack(alignment: .leading, spacing: DSSpacing.xs) {
            sectionTitle("rating.section.stars")
            HStack(spacing: DSSpacing.xs) {
                ForEach(1...5, id: \.self) { idx in
                    Button {
                        viewModel.setStars(idx)
                    } label: {
                        Image(systemName: idx <= current ? "star.fill" : "star")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundStyle(idx <= current ? DSColor.accent : DSColor.textTertiary)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(format: String(localized: "rating.stars.value_format"), idx)))
                    .accessibilityAddTraits(idx == current ? .isSelected : [])
                }
            }
            .padding(.vertical, DSSpacing.xs)
            .padding(.horizontal, DSSpacing.xs)
            .background(RoundedRectangle(cornerRadius: DSRadius.md).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: DSRadius.md).strokeBorder(DSColor.border, lineWidth: 1))
            if current > 0 {
                Text(starsCaption(current))
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
    }

    private func starsCaption(_ stars: Int) -> String {
        switch stars {
        case 1: return String(localized: "rating.stars.caption.1")
        case 2: return String(localized: "rating.stars.caption.2")
        case 3: return String(localized: "rating.stars.caption.3")
        case 4: return String(localized: "rating.stars.caption.4")
        case 5: return String(localized: "rating.stars.caption.5")
        default: return ""
        }
    }

    // MARK: Tags

    private func tagsSection(_ player: Participant) -> some View {
        let draft = viewModel.draft(for: player.user_id)
        return VStack(alignment: .leading, spacing: DSSpacing.xs) {
            sectionTitle("rating.section.tags")
            Text("rating.section.tags.hint")
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            FlowLayout(spacing: DSSpacing.xs) {
                ForEach(RatingTag.allCases) { tag in
                    tagChip(tag, selected: draft.tags.contains(tag))
                }
            }
            .padding(.top, 2)
        }
    }

    private func tagChip(_ tag: RatingTag, selected: Bool) -> some View {
        let isNegative = tag.isNegative
        let tint = isNegative ? DSColor.danger : DSColor.accent
        return Button {
            viewModel.toggleTag(tag)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: tag.icon)
                    .font(.system(size: 12, weight: .bold))
                Text(LocalizedStringKey(tag.labelKey))
                    .font(DSType.metaCaption)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(selected ? DSColor.textOnAccent : tint)
            .background(
                Capsule().fill(selected ? tint : Color.clear)
            )
            .overlay(
                Capsule().strokeBorder(tint.opacity(selected ? 0 : 0.6),
                                       lineWidth: 1.2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Footer

    private func footer(for player: Participant) -> some View {
        let canGoBack = viewModel.index > 0
        let isLast = viewModel.index == viewModel.coplayers.count - 1
        let draftReady = viewModel.isDraftComplete(for: player.user_id)
        return VStack(spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.sm) {
                if canGoBack {
                    Button {
                        viewModel.goBack()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 13, weight: .bold))
                            Text("rating.back")
                                .font(DSType.bodyEmphasis)
                        }
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, DSSpacing.sm)
                        .foregroundStyle(DSColor.textPrimary)
                        .background(Capsule().fill(DSColor.surfaceElevated))
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
                if isLast {
                    PrimaryButton(
                        title: String(localized: "rating.submit"),
                        icon: "paperplane.fill",
                        isLoading: viewModel.isSubmitting,
                        isEnabled: viewModel.isComplete && !viewModel.isSubmitting
                    ) {
                        Task {
                            if await viewModel.submit() {
                                Haptics.success()
                                onFinished()
                            } else {
                                Haptics.error()
                            }
                        }
                    }
                    .frame(maxWidth: 240)
                } else {
                    PrimaryButton(
                        title: String(localized: "rating.next"),
                        icon: "chevron.right",
                        isLoading: false,
                        isEnabled: draftReady
                    ) {
                        viewModel.goNext()
                    }
                    .frame(maxWidth: 240)
                }
            }
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.sm)
        .background(.ultraThinMaterial)
    }

    // MARK: Helpers

    private func sectionTitle(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(DSType.bodyEmphasis)
            .foregroundStyle(DSColor.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func initials(_ name: String) -> String {
        name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }.joined()
    }
}

// MARK: - FlowLayout

/// Wrapping HStack — drops chips to the next row when they overflow.
/// Self-contained so the rating view can render an arbitrary number of
/// behavior tags without a fixed grid.
private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var contentWidth: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth && rowWidth > 0 {
                totalHeight += rowHeight + spacing
                contentWidth = max(contentWidth, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        contentWidth = max(contentWidth, rowWidth - spacing)
        return CGSize(width: contentWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
