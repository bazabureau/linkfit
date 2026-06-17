import CoreGraphics

/// Continuous corner radii (use with `.cornerRadius(_, style: .continuous)` or
/// `RoundedRectangle(cornerRadius:style:.continuous)`).
public enum DSRadius {
    public static let button: CGFloat = 16
    public static let chip: CGFloat = 12
    public static let card: CGFloat = 20
    public static let sheet: CGFloat = 26
    public static let pill: CGFloat = 999
}

/// Spacing scale — always use a named value, never an arbitrary number.
public enum DSSpacing {
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 6
    public static let s: CGFloat = 8
    public static let sm: CGFloat = 10
    public static let m: CGFloat = 12
    public static let ml: CGFloat = 14
    public static let l: CGFloat = 16
    public static let xl: CGFloat = 20
    public static let xxl: CGFloat = 24
    public static let xxxl: CGFloat = 28
    public static let huge: CGFloat = 32
    public static let jumbo: CGFloat = 40

    /// Page horizontal margin.
    public static let page: CGFloat = 20
    /// Gap between major page sections.
    public static let section: CGFloat = 24
    /// Internal card padding.
    public static let card: CGFloat = 16
}
