import SwiftUI

/// Lightweight helpers around `UserInterfaceSizeClass` so feature views can
/// answer the only question they actually care about — "do I have room for
/// a side-by-side layout?" — without reimporting `UIKit` everywhere.
///
/// Apple's size-class system already does the heavy lifting:
///   * iPhone portrait, iPhone landscape on most models → `.compact` width
///   * iPhone Plus/Max in landscape, every iPad, Split View, Slide Over with
///     wide layout → `.regular` width
///
/// We deliberately treat `nil` (size class not yet resolved) as `.compact`
/// so the first paint never flashes a regression-prone iPad layout on iPhone.
enum LayoutSize {
    /// Returns `true` when the environment has enough horizontal room for a
    /// two-column layout. Single source of truth used by `AdaptiveSplit` and
    /// `MaxWidthConstrained` — keeps the heuristic in one place if we ever
    /// want to consult dynamic type or actual geometry as well.
    @inlinable
    static func isWideLayout(_ horizontalSizeClass: UserInterfaceSizeClass?) -> Bool {
        horizontalSizeClass == .regular
    }
}
