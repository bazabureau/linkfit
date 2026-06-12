import SwiftUI

/// Pre-baked placeholder shapes that match the most common content
/// layouts in the app. They're standalone `View`s that build their own
/// geometry and then forward to the `.skeleton(true)` modifier — callers
/// don't need to pass `isLoading`; if you're rendering one of these, you
/// are loading.
///
/// Available shapes:
///
/// - ``SkeletonRow``  — avatar + two text-line placeholders. Mirrors the
///   chat/match/friend list row.
/// - ``SkeletonCard`` — 160pt-tall vertical card. Mirrors a venue or
///   match card.
/// - ``SkeletonGrid`` — a 2-column grid of `SkeletonCard`s. Use inside
///   discovery / browse screens.

// MARK: - Row

/// A horizontal row placeholder: a 48pt circular avatar on the leading
/// edge, followed by two stacked text-line bars.
///
/// Use anywhere a `HStack { Avatar; VStack { Title; Subtitle } }` would
/// normally render — friends list, chat list, match candidate list.
struct SkeletonRow: View {
    /// How wide the longer (top) line should be relative to the full
    /// trailing column. Defaults to 70%, which reads as a "title" line.
    var titleWidthRatio: CGFloat = 0.7

    /// How wide the shorter (bottom) line should be. Defaults to 45%,
    /// which reads as a "subtitle / metadata" line.
    var subtitleWidthRatio: CGFloat = 0.45

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            // Avatar — 48pt fixed so it lines up with the real
            // `CachedAsyncImage` avatars used across the app.
            Circle()
                .frame(width: 48, height: 48)
                .skeleton(true)

            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                // Title line. `GeometryReader` lets us measure the
                // available width so the ratios actually mean something
                // regardless of where this row is dropped in.
                GeometryReader { geo in
                    VStack(alignment: .leading, spacing: DSSpacing.xs) {
                        RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                            .frame(width: geo.size.width * titleWidthRatio, height: 14)
                            .skeleton(true)

                        RoundedRectangle(cornerRadius: DSRadius.xs, style: .continuous)
                            .frame(width: geo.size.width * subtitleWidthRatio, height: 12)
                            .skeleton(true)
                    }
                }
                // The GeometryReader expands to fill — we need to bound
                // it vertically so the row doesn't grow to infinity.
                .frame(height: 14 + DSSpacing.xs + 12)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(localized: "loading.default"))
    }
}

// MARK: - Card

/// A 160pt-high vertical card placeholder. Mirrors the venue/match cards
/// rendered on the home and discovery screens: media-on-top + two text
/// lines underneath.
///
/// The whole card sits inside a single rounded surface so the shimmer
/// reads as one continuous panel rather than three disconnected bars.
struct SkeletonCard: View {
    /// Total card height. Defaults to 160pt to match the standard
    /// venue/match tile; callers can override for taller hero variants.
    var height: CGFloat = 160

    var body: some View {
        RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
            .frame(height: height)
            .skeleton(true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(String(localized: "loading.default"))
    }
}

// MARK: - Grid

/// A 2-column grid of `SkeletonCard`s. Drop into discovery / browse
/// screens while the underlying data is in flight.
///
/// Renders a fixed `count` of placeholder cards so layout doesn't pop
/// when the real data arrives — pick a count that approximates the first
/// page of results.
struct SkeletonGrid: View {
    /// How many placeholder cards to render. Defaults to 4 — a
    /// "two rows of two" silhouette that covers above-the-fold on most
    /// phones without flooding the screen.
    var count: Int = 4

    /// Per-card height passed through to `SkeletonCard`.
    var cardHeight: CGFloat = 160

    /// Column layout — two flexible columns with consistent gutter.
    /// Pulled out so the body stays readable.
    private var columns: [GridItem] {
        [
            GridItem(.flexible(), spacing: DSSpacing.sm),
            GridItem(.flexible(), spacing: DSSpacing.sm)
        ]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: DSSpacing.sm) {
            // `id: \.self` is fine here — the indices are stable and the
            // skeleton has no state we need to preserve across rebuilds.
            ForEach(0..<count, id: \.self) { _ in
                SkeletonCard(height: cardHeight)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(localized: "loading.default"))
    }
}
