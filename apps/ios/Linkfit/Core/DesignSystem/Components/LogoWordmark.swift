import SwiftUI

/// Brand wordmark — the actual `linkfit` lockup with the lime accent
/// shipped by design (Assets.xcassets/Logo.imageset). Use this wherever
/// the brand identity should appear horizontally:
///   - top of auth/login screens
///   - splash hero
///   - in-app section headers
///
/// The image is a 989×133 PNG (~7.4:1 aspect). We size by **height** and
/// let width auto-derive, which is what every consumer expects (the
/// available vertical space is usually the limit — top bars, hero rows).
struct LogoWordmark: View {
    enum Size {
        case s   // 18pt height — top bar
        case m   // 28pt height — auth screen banner
        case l   // 44pt height — splash hero
        case xl  // 64pt height — onboarding
        case custom(CGFloat)
        var height: CGFloat {
            switch self {
            case .s: return 18
            case .m: return 28
            case .l: return 44
            case .xl: return 64
            case .custom(let v): return v
            }
        }
    }

    var size: Size = .m
    /// When set, recolors the entire image using a template tint. Useful
    /// on dark hero backgrounds where the original white logo already
    /// reads, but the accent shouldn't fight the page palette. Defaults
    /// to `nil` (no tint — use the original PNG colors).
    var tint: Color? = DSColor.textPrimary

    var body: some View {
        Group {
            if let tint {
                Image("Logo")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(tint)
            } else {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(height: size.height)
        .accessibilityLabel("Linkfit")
        .accessibilityAddTraits(.isImage)
    }
}

#Preview("LogoWordmark sizes") {
    VStack(spacing: 24) {
        LogoWordmark(size: .s)
        LogoWordmark(size: .m)
        LogoWordmark(size: .l)
        LogoWordmark(size: .xl)
    }
    .padding()
    .background(Color.black)
}
