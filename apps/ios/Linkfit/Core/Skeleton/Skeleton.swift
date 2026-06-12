import SwiftUI

/// A reusable shimmer/skeleton loading modifier.
///
/// When `isLoading == true`, the modified view is hidden and replaced with a
/// same-shape gray rectangle that sweeps a soft linear gradient highlight
/// across itself once every 1.5 seconds. When `isLoading == false`, the
/// underlying view renders normally — no overhead, no allocations.
///
/// The size of the placeholder is read from the underlying view via a
/// hidden copy in the background, so the skeleton matches whatever frame
/// the real content would have occupied. Callers do not have to specify
/// a width or height manually.
///
/// Usage:
///
/// ```swift
/// Text(viewModel.title)
///     .skeleton(viewModel.isLoading)
/// ```
///
/// For composed placeholders (a row, a card, a grid) prefer the helper
/// shapes in `SkeletonShapes.swift` rather than building bespoke layouts.
///
/// Accessibility: respects `accessibilityReduceMotion`. When the user has
/// requested reduced motion the shimmer animation is suppressed and the
/// placeholder renders as a static muted rectangle.
struct Skeleton: ViewModifier {
    /// Drives the loading state. `true` hides the underlying content and
    /// shows the shimmer; `false` shows the real content.
    let isLoading: Bool

    /// User-level "Reduce Motion" preference. We read it via the
    /// environment so the modifier reacts live if the user flips it in
    /// Settings while the app is running.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Drives the gradient sweep. We mutate `phase` on appear from `0` to
    /// `1`; the `.animation(...)` modifier turns that single state change
    /// into a forever-repeating linear interpolation.
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        if isLoading {
            // The underlying view still informs the layout — it is hidden
            // (opacity 0) and not interactive, but it gives the skeleton
            // a frame to match. Then we overlay the placeholder + shimmer.
            content
                .opacity(0)
                .accessibilityHidden(true)
                .overlay(placeholder)
                // Disable interaction while the skeleton is showing so the
                // user can't accidentally trigger taps on hidden content.
                .allowsHitTesting(false)
        } else {
            content
        }
    }

    /// The static gray placeholder plus the animated shimmer overlay.
    /// `GeometryReader` would also work, but `.frame` inherited from the
    /// underlying view via `.overlay` is simpler and avoids the ambiguous
    /// sizing that `GeometryReader` introduces inside stacks.
    private var placeholder: some View {
        Rectangle()
            .fill(DSColor.surfaceElevated)
            .overlay(shimmer)
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
            .accessibilityLabel(String(localized: "loading.default"))
    }

    /// The moving gradient. We render it across a 3x-wide rectangle and
    /// translate it via `startPoint` / `endPoint` so the highlight slides
    /// from the left edge to the right edge over 1.5s. The whole thing is
    /// masked to the placeholder shape so the shimmer never escapes.
    private var shimmer: some View {
        // Anchors run from (-1, 0)→(0, 0) to (1, 0)→(2, 0), giving a full
        // off-screen-left to off-screen-right sweep. `phase` linearly
        // interpolates between the two extremes.
        let start = UnitPoint(x: -1 + 2 * phase, y: 0.5)
        let end   = UnitPoint(x:  0 + 2 * phase, y: 0.5)

        return LinearGradient(
            colors: [
                DSColor.textPrimary.opacity(0.04),
                DSColor.textPrimary.opacity(0.14),
                DSColor.textPrimary.opacity(0.04)
            ],
            startPoint: start,
            endPoint: end
        )
        .mask(
            // Match the placeholder's rounded corners so the shimmer
            // doesn't bleed past the visible edge.
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
        )
        .animation(
            // Reduce-motion: no animation at all. The placeholder is still
            // visible, just without the moving highlight.
            reduceMotion
                ? nil
                : .linear(duration: 1.5).repeatForever(autoreverses: false),
            value: phase
        )
        .onAppear {
            // Skip the state change when reduce-motion is on — otherwise
            // SwiftUI still records the implicit transition and we'd be
            // burning a frame on something invisible.
            guard !reduceMotion else { return }
            phase = 1
        }
    }
}

extension View {
    /// Apply a shimmering skeleton placeholder while `isLoading` is true.
    ///
    /// The placeholder takes the same frame the view would normally
    /// occupy, so call this on the *outermost* shape of whatever should be
    /// covered — wrapping a `Text` skeletonises the text; wrapping a
    /// whole `HStack` skeletonises the row.
    ///
    /// - Parameter isLoading: When `true`, render a shimmer placeholder
    ///   in place of the content. When `false`, render the content
    ///   untouched.
    func skeleton(_ isLoading: Bool) -> some View {
        modifier(Skeleton(isLoading: isLoading))
    }
}
