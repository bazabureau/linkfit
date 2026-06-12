import SwiftUI
import Observation

/// "Bugünki tapşırıqlar" — compact home card listing the user's three
/// daily challenges. Drops onto HomeView's main scroll between the
/// suggested-follows rail and the stories rail (search for the section
/// anchor comment `HOME_SECTION_ANCHOR_W10_CHALLENGES` in `HomeView.swift`).
///
/// Design notes:
///   * Auto-hides when all three are completed — surfaces the
///     "earned daily bonus" feeling and clears the slot on home for the
///     other sections without ceremony.
///   * Each row dims to `textTertiary` + check-mark when completed; the
///     row stays in place (no collapse) so the third row's tap target
///     doesn't shift mid-day as the user knocks things off.
///   * Tapping a row routes to the relevant action surface via
///     `onTap(_:)` — the host (HomeView) owns navigation, the card just
///     hands back the code. The card flips the row to "completed
///     locally" optimistically so the user gets immediate feedback;
///     the server stamp lands on the next /today refetch.
///   * Section anchor comment lets a localisation collator or other
///     Wave-10 agent (W10-12 announcements) find the wire-up site
///     without ripping HomeView.
struct DailyChallengesCard: View {
    @State var viewModel: DailyChallengesViewModel
    let onTap: (ChallengeCode) -> Void

    var body: some View {
        Group {
            if shouldHide {
                EmptyView()
            } else {
                content
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .task { await viewModel.load() }
    }

    /// Hide the whole card when:
    ///   - the cold load hasn't returned yet (`.idle` would leave a
    ///     header floating with no rows; loading state shows skeleton
    ///     rows so we DON'T hide there);
    ///   - all three challenges are completed for the day;
    ///   - the load failed silently (we'd rather drop the surface than
    ///     show "error" on home — the next refresh retries).
    private var shouldHide: Bool {
        switch viewModel.state {
        case .idle, .empty, .error:
            return true
        case .loading:
            return false
        case .loaded:
            return viewModel.allCompleted
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            header
            rows
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .padding(.horizontal, DSSpacing.md)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "checklist")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.accent)
            Text("challenges.card.title")
                .font(.system(size: 16, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textPrimary)
            Spacer()
            if case let .loaded(payload) = viewModel.state {
                Text(progressLabel(payload.challenges))
                    .font(.system(.caption, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
    }

    @ViewBuilder
    private var rows: some View {
        switch viewModel.state {
        case .loading:
            VStack(spacing: DSSpacing.xs) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                        .fill(DSColor.surfaceElevated)
                        .frame(height: 44)
                }
            }
        case .loaded(let payload):
            VStack(spacing: DSSpacing.xs) {
                ForEach(payload.challenges) { item in
                    ChallengeRow(item: item) {
                        // Optimistic flip — feels instant on tap.
                        viewModel.markCompletedLocally(code: item.code)
                        onTap(item.code)
                    }
                }
            }
        default:
            EmptyView()
        }
    }

    /// "X/3 tamamlanıb" — compact progress count. Calculated on the
    /// callsite rather than the VM so the format string can be picked
    /// up by the locale.
    private func progressLabel(_ items: [ChallengeItem]) -> String {
        let done = items.filter { $0.isCompleted }.count
        return String(format: String(localized: "challenges.card.progress_format"),
                      done, items.count)
    }
}

/// One row inside the card. Shows the localized title (`challenges.title.<code>`),
/// a leading SF Symbol, and a trailing check-mark when completed.
/// Completed rows dim to `textTertiary` so the user's eye skips them.
struct ChallengeRow: View {
    let item: ChallengeItem
    let onTap: () -> Void

    var body: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onTap()
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle()
                        .fill(item.isCompleted
                              ? DSColor.accent.opacity(0.18)
                              : DSColor.surfaceElevated)
                        .frame(width: 32, height: 32)
                    Image(systemName: iconName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(item.isCompleted
                                         ? DSColor.accent
                                         : DSColor.textSecondary)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(titleKey)
                        .font(.system(size: 14, weight: .semibold, design: .default))
                        .foregroundStyle(item.isCompleted
                                         ? DSColor.textTertiary
                                         : DSColor.textPrimary)
                        .strikethrough(item.isCompleted, color: DSColor.textTertiary)
                    if !item.isCompleted {
                        Text(bodyKey)
                            .font(.system(.caption, design: .default))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
                Spacer()
                if item.isCompleted {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundStyle(DSColor.accent)
                        .transition(.scale.combined(with: .opacity))
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(DSColor.textTertiary)
                }
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .fill(DSColor.surfaceElevated.opacity(item.isCompleted ? 0.4 : 1.0))
            )
        }
        .buttonStyle(SpringPressStyle())
        .disabled(item.isCompleted)
    }

    /// xcstrings key for the row's title. Format: `challenges.title.<code>`.
    private var titleKey: LocalizedStringKey {
        LocalizedStringKey("challenges.title.\(item.code.rawValue)")
    }

    /// xcstrings key for the row's body. Format: `challenges.body.<code>`.
    private var bodyKey: LocalizedStringKey {
        LocalizedStringKey("challenges.body.\(item.code.rawValue)")
    }

    /// Static per-code SF Symbol map. Prefer this over the server's
    /// `icon` hint because the iOS-side glyphs are part of the design
    /// system contract and shouldn't drift on a server-side typo.
    private var iconName: String {
        switch item.code {
        case .follow_one:      return "person.crop.circle.badge.plus"
        case .join_a_game:     return "figure.tennis"
        case .post_a_story:    return "camera.fill"
        case .comment_on_feed: return "bubble.left.fill"
        case .invite_to_game:  return "paperplane.fill"
        case .react_to_story:  return "heart.fill"
        }
    }
}
