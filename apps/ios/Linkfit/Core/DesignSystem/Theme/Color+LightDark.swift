import SwiftUI
import UIKit

/// Two-tone color helper: resolves to the right shade based on the active
/// `UITraitCollection.userInterfaceStyle`. SwiftUI's `Color` doesn't expose
/// a first-party `Color(light:dark:)` initializer, so we bridge through
/// `UIColor(dynamicProvider:)` which iOS evaluates lazily at draw time —
/// meaning `.preferredColorScheme(_:)` flips every token automatically.
extension Color {
    /// Build a dynamic `Color` that resolves to `light` in light mode and
    /// `dark` in dark mode. The resolution happens per draw, so the same
    /// `Color` instance is correct in any environment it's used in.
    init(light: Color, dark: Color) {
        self = Color(uiColor: UIColor { trait in
            switch trait.userInterfaceStyle {
            case .light:    return UIColor(light)
            case .dark:     return UIColor(dark)
            case .unspecified: return UIColor(dark)
            @unknown default: return UIColor(dark)
            }
        })
    }

    /// Convenience for the hex-literal style used across DSColor.
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >>  8) & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
