import CoreGraphics

/// 4-pt base, doubled up to a 64-pt extreme. Hardcoded magic numbers in views
/// are a code smell — they always map to one of these.
enum DSSpacing {
    static let xxs: CGFloat = 4
    static let xs:  CGFloat = 8
    static let sm:  CGFloat = 12
    static let md:  CGFloat = 16
    static let lg:  CGFloat = 24
    static let xl:  CGFloat = 32
    static let xxl: CGFloat = 48
    static let xxxl: CGFloat = 64

    /// Returned in ascending order — used by tests to enforce monotonicity.
    static let scale: [CGFloat] = [xxs, xs, sm, md, lg, xl, xxl, xxxl]
}
