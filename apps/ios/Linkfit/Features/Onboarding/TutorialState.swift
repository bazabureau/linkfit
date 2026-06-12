import Foundation
import SwiftUI

/// Tracks whether the first-launch tutorial overlay has been seen.
///
/// Mirrors the `@Observable` + `@MainActor` pattern used by `ThemeManager`
/// and `LanguageManager`. Backed by `UserDefaults.standard` under the key
/// `LinkfitHasSeenTutorial` so the flag survives app re-launches but is
/// cleared on uninstall — first-time experience by design.
///
/// The tutorial itself is NOT auto-presented anywhere; this type only owns
/// the persistence. See `TutorialOverlay` for the wiring snippet that the
/// host scene should adopt once it's ready.
@Observable
@MainActor
final class TutorialState {
    /// `true` once the user has dismissed the tutorial. Writing this value
    /// persists immediately, so toggling it from anywhere in the app is
    /// safe and idempotent.
    var hasSeenTutorial: Bool {
        didSet {
            UserDefaults.standard.set(hasSeenTutorial, forKey: Self.storageKey)
        }
    }

    /// `UserDefaults` key. Public so tests can clear it.
    static let storageKey = "LinkfitHasSeenTutorial"

    init(defaults: UserDefaults = .standard) {
        self.hasSeenTutorial = defaults.bool(forKey: Self.storageKey)
    }

    /// Mark the tutorial as seen. Called from the final card's CTA.
    func markSeen() {
        guard !hasSeenTutorial else { return }
        hasSeenTutorial = true
    }
}
