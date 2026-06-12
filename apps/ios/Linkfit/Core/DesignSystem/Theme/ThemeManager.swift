import SwiftUI

/// Owns the user's appearance preference. Mirrors the pattern used by
/// `LanguageManager` — `@Observable` + `@MainActor`, persists to
/// `UserDefaults`, injected into the SwiftUI environment from `LinkfitApp`.
///
/// Default is `.dark` — Linkfit's brand voice is a deep dark canvas with
/// lime accent. Users can opt into `.light` (a warm cream alternative) or
/// `.system` to follow iOS.
@Observable
@MainActor
final class ThemeManager {
    /// Current user-selected mode. Writing this persists immediately.
    var mode: AppearanceMode {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: Self.storageKey)
        }
    }

    static let storageKey = "linkfit.theme.mode"

    /// `ColorScheme?` to feed into `.preferredColorScheme(_:)` at the root
    /// of the scene. Forced to `.light` to satisfy the requirement that the
    /// app should not run in dark mode and should have a white background.
    var resolved: ColorScheme? { mode.colorScheme }

    init() {
        if let raw = UserDefaults.standard.string(forKey: Self.storageKey),
           let stored = AppearanceMode(rawValue: raw) {
            self.mode = stored
        } else {
            self.mode = .light
        }
    }
}
