import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public extension Color {
    /// `Color(hex: 0x5662D9)` — sRGB, no alpha component in the literal.
    init(hex: UInt32, alpha: Double = 1) {
        let red = Double((hex >> 16) & 0xFF) / 255
        let green = Double((hex >> 8) & 0xFF) / 255
        let blue = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }

    /// Light/dark adaptive color. Resolves per trait collection so every token
    /// is correct in both appearances without the call site checking the scheme.
    init(light: Color, dark: Color) {
        #if canImport(UIKit)
        self = Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
        #else
        self = light
        #endif
    }
}
