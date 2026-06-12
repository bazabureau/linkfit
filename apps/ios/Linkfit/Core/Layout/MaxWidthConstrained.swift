import SwiftUI

/// Caps the receiver's width to a comfortable reading measure on wide
/// layouts (iPad, large landscape phones) while staying full-width on iPhone
/// portrait. Keeps long-form screens (game detail, tournament detail,
/// settings) from stretching edge-to-edge on a 13-inch iPad where line
/// lengths would otherwise blow past 120 characters.
///
/// We picked **800 pt** as the cap — wide enough for a two-column form row
/// or a hero image, narrow enough that body text stays around the
/// 65–75 char "ideal measure". The content is centred via `frame(maxWidth:)`
/// so chrome (backgrounds, navigation bars) still bleed to the screen edge.
///
/// Apply at the *outermost* `ScrollView`/`VStack` of a long-form screen.
struct MaxWidthConstrained: ViewModifier {
    /// 800 pt. Matches the readable-content guide Apple uses on iPad in
    /// `UITableView` and is a well-trodden web reading-measure ceiling.
    static let defaultMaxWidth: CGFloat = 800

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    let maxWidth: CGFloat

    func body(content: Content) -> some View {
        if LayoutSize.isWideLayout(horizontalSizeClass) {
            content
                .frame(maxWidth: maxWidth)
                .frame(maxWidth: .infinity)   // centre inside parent
        } else {
            content
        }
    }
}

extension View {
    /// Caps content width to a readable measure on regular size classes.
    /// No-op on compact (iPhone portrait) — the call site can apply
    /// unconditionally.
    func maxWidthConstrained(_ maxWidth: CGFloat = MaxWidthConstrained.defaultMaxWidth) -> some View {
        modifier(MaxWidthConstrained(maxWidth: maxWidth))
    }
}
