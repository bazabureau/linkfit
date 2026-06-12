import SwiftUI

/// `SkeletonView` — typed, count-driven shimmer placeholder used while
/// any list/grid surface is loading. Wraps the existing `.skeleton(true)`
/// modifier (defined in `Core/Skeleton/Skeleton.swift`) so we don't
/// duplicate the shimmer engine — this file is the **shape vocabulary**
/// for empty-state UX, not a new animator.
///
/// Why a new file when `SkeletonShapes.swift` already exists?
///   - The existing helpers expose three loose top-level structs
///     (`SkeletonRow`, `SkeletonCard`, `SkeletonGrid`). Each call site
///     has to pick one and write its own `ForEach`. That's fine for ad-hoc
///     usage, but for *premium screen-level* loaders (Players / Matches /
///     Follows) we want one entry point: "give me N rows / cards in the
///     visual style the rest of the screen already uses (glass + accent
///     border)".
///   - This `SkeletonView` is that entry point. It renders the same
///     ultraThinMaterial card chrome the screens already use for real
///     content, so when the data lands the layout doesn't pop.
///
/// Usage:
///
/// ```swift
/// SkeletonView(shape: .row, count: 6)     // friend list / player list
/// SkeletonView(shape: .card, count: 4)    // game / match cards
/// SkeletonView(shape: .avatar, count: 8)  // follower rows (avatar + 2
///                                         // text lines + follow pill)
/// ```
///
/// Accessibility: shimmer animation respects
/// `accessibilityReduceMotion` — when the user has Reduce Motion on, the
/// underlying `.skeleton(true)` modifier degrades to a static gray
/// rectangle (no sweep). The whole view is also marked
/// `accessibilityHidden(true)` because skeletons carry no information —
/// VoiceOver users get the same "Yüklənir" cue from the screen's normal
/// loading affordances.
struct SkeletonView: View {
    /// The shape vocabulary. Each case produces a different per-item
    /// silhouette tuned to match a real content row in the app.
    enum Shape {
        /// 72pt-tall horizontal row: avatar circle on the leading edge,
        /// title + subtitle on the trailing side. Mirrors the
        /// `PlayerRowCard` and the `FollowListView` row layout.
        case row
        /// 110pt-tall vertical card: header strip + capacity bar at the
        /// bottom. Mirrors `MatchRowCard`.
        case card
        /// 72pt-tall horizontal row WITH a trailing pill — like `row`,
        /// but reserves space for a follow / action button at the end so
        /// the layout doesn't shift when the real content lands.
        case avatar
    }

    let shape: Shape
    /// How many skeleton items to render. Pick a value that approximates
    /// the first page of results so the screen doesn't feel empty while
    /// loading.
    let count: Int

    var body: some View {
        VStack(spacing: 10) {
            // `id: \.self` is fine here — the indices are stable for the
            // lifetime of the load and the skeleton itself has no state
            // we need to preserve across rebuilds.
            ForEach(0..<count, id: \.self) { _ in
                item
            }
        }
        // Skeletons are pure visual filler — they carry no semantic
        // content, so we hide them from assistive tech. The host screen
        // provides its own "Yüklənir" announcement via the surrounding
        // navigation chrome / refreshable label.
        .accessibilityHidden(true)
    }

    /// Per-shape silhouette. Each branch composes a glass card outer
    /// chrome (ultraThinMaterial + border) so the skeleton matches the
    /// real cards the user is about to see — no jarring switch from
    /// "plain gray rectangle" to "lime-accented glass card" when the
    /// fetch completes.
    @ViewBuilder
    private var item: some View {
        switch shape {
        case .row:
            rowSilhouette
        case .card:
            cardSilhouette
        case .avatar:
            avatarRowSilhouette
        }
    }

    // MARK: - Row (avatar + 2 text lines)

    /// Matches `PlayerRowCard`: 48pt circular avatar + name line + meta
    /// line. The outer glass card uses the same 18pt corner radius and
    /// the same ultraThinMaterial fill as the real card.
    private var rowSilhouette: some View {
        HStack(spacing: 14) {
            Circle()
                .frame(width: 48, height: 48)
                .skeleton(true)

            VStack(alignment: .leading, spacing: 6) {
                // Title bar — heavier weight equivalent.
                RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                    .frame(width: 140, height: 14)
                    .skeleton(true)
                // Subtitle bar — meta line equivalent.
                RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                    .frame(width: 90, height: 11)
                    .skeleton(true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(height: 72)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Card (game / match)

    /// Matches `MatchRowCard`: a header line, a venue line, and a thin
    /// capacity bar. Drawn at 110pt to mirror the real card height.
    private var cardSilhouette: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Title row — headline + (host badge slot).
            HStack {
                RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                    .frame(width: 160, height: 15)
                    .skeleton(true)
                Spacer()
                RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                    .frame(width: 60, height: 14)
                    .skeleton(true)
            }
            // Venue line.
            RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                .frame(width: 200, height: 12)
                .skeleton(true)
            // Capacity bar — thin pill that fills horizontally.
            Capsule()
                .frame(height: 6)
                .skeleton(true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 110)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Avatar row (with trailing follow pill)

    /// Matches `FollowListView` row: avatar + name/meta + trailing
    /// follow-button pill. Reserved space for the pill keeps the layout
    /// identical when real rows render.
    private var avatarRowSilhouette: some View {
        HStack(spacing: 14) {
            Circle()
                .frame(width: 44, height: 44)
                .skeleton(true)

            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                    .frame(width: 130, height: 13)
                    .skeleton(true)
                RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                    .frame(width: 80, height: 10)
                    .skeleton(true)
            }
            Spacer(minLength: 0)
            // Trailing pill — reserves room for the follow button so the
            // row layout doesn't snap when content lands.
            Capsule()
                .frame(width: 68, height: 26)
                .skeleton(true)
        }
        .padding(14)
        .frame(height: 72)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1)
        )
    }
}
