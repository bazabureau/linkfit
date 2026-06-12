import SwiftUI

/// User-facing appearance preference. Persisted as a raw string in
/// `UserDefaults` under `linkfit.theme.mode`. Default is `.dark` — the brand
/// voice — but the user can switch to `.light` (a polished alternative, not
/// just an inverted dark) or `.system` to follow iOS.
enum AppearanceMode: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    var id: String { rawValue }

    /// SwiftUI `ColorScheme?` to feed into `.preferredColorScheme(_:)`.
    /// `nil` for `.system` so SwiftUI follows the device setting.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }

    /// Localised label key for picker rows.
    var displayKey: LocalizedStringKey {
        switch self {
        case .system: return "settings.theme.system"
        case .light:  return "settings.theme.light"
        case .dark:   return "settings.theme.dark"
        }
    }

    /// SF Symbol that hints at the mode visually inside the picker.
    var symbolName: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light:  return "sun.max.fill"
        case .dark:   return "moon.fill"
        }
    }
}
