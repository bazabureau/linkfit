import SwiftUI

/// Semantic color tokens — the single source of truth ported 1:1 from the web
/// "Meydan" system so the app reads as the same product as linkfit.az. Never use
/// raw colors in feature code; add a token here instead.
public enum DSColor {
    // MARK: Canvas & surfaces
    public static let background = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x0A0D12))
    public static let canvas = Color(light: Color(hex: 0xF3F5FA), dark: Color(hex: 0x0A0D12))
    public static let surface = Color(light: Color(hex: 0xF3F5FA), dark: Color(hex: 0x12161F))
    public static let surface2 = Color(light: Color(hex: 0xE9EDF7), dark: Color(hex: 0x1A1F2B))
    public static let card = Color(light: Color(hex: 0xFFFFFF), dark: Color(hex: 0x12161F))

    // MARK: Hairlines
    public static let border = Color(light: Color(hex: 0xE7EAF3), dark: Color(hex: 0x232A39))
    public static let borderStrong = Color(light: Color(hex: 0xD6DCEC), dark: Color(hex: 0x303849))

    // MARK: Ink (text)
    public static let textPrimary = Color(light: Color(hex: 0x0B1020), dark: Color(hex: 0xF4F6FB))
    public static let textMuted = Color(light: Color(hex: 0x4D5478), dark: Color(hex: 0xA3ABCE))
    public static let textDim = Color(light: Color(hex: 0x868EB2), dark: Color(hex: 0x757DA6))
    public static let textOnAccent = Color.white

    // MARK: Brand — royal blue carries all interactive meaning
    public static let accent = Color(hex: 0x5662D9)
    public static let accentSoft = Color(hex: 0x6E79E2)
    public static let accentDeep = Color(hex: 0x3F4AC0)
    /// Tinted wash for pressed / selected backgrounds.
    public static let accentMuted = Color(light: Color(hex: 0x5662D9, alpha: 0.12),
                                          dark: Color(hex: 0x6E79E2, alpha: 0.18))

    /// Lime — brand mark + rare highlight only. Sits on dark ink with dark text.
    public static let lime = Color(hex: 0xC5F235)
    public static let limeDeep = Color(hex: 0xAAD426)

    /// Deep navy used behind photography (matches web `--court-ink`).
    public static let courtInk = Color(hex: 0x07101B)
    public static let ink = Color(hex: 0x0E1116)

    // MARK: State
    public static let danger = Color(light: Color(hex: 0xE5484D), dark: Color(hex: 0xFF6369))
    public static let warning = Color(light: Color(hex: 0xF5A524), dark: Color(hex: 0xFFC53D))
    public static let success = Color(light: Color(hex: 0x30A46C), dark: Color(hex: 0x3DD68C))
    public static let info = accent

    // MARK: Medals (rank 1/2/3 only)
    public static let medalGold = Color(hex: 0xE8B931)
    public static let medalSilver = Color(hex: 0xA8B0C2)
    public static let medalBronze = Color(hex: 0xC08457)
}
