import Foundation

/// App-level locale override.
///
/// The user's chosen language wins over the system language. The selection is
/// stored in `UserDefaults` under the `LinkfitPreferredLanguage` key. When set
/// to `nil`, the app falls back to the system language (the device's standard
/// `Bundle.main.preferredLocalizations` order).
///
/// **Important — `AppleLanguages` takes effect on the NEXT app launch.**
/// `Foundation` reads `AppleLanguages` once during process startup to build
/// `Bundle.main.preferredLocalizations`. Mutating it at runtime does NOT
/// retroactively change `String(localized:)` / `NSLocalizedString` lookups in
/// the current process — for in-session language switching the app must also
/// route through the runtime bundle swap implemented in `AppLanguage.swift`
/// (see `Bundle.applyLanguage(_:)`). This actor's job is the persistence and
/// the launch-time override so the user's preference outranks the system
/// locale; it is NOT a live-reload mechanism.
@Observable @MainActor
final class LocaleManager {
    /// The currently-applied language code (`"az"`, `"en"`, `"ru"`) or `nil`
    /// when the user has chosen to follow the system language.
    private(set) var current: String?

    static let shared = LocaleManager()

    private let key = "LinkfitPreferredLanguage"

    init() {
        current = UserDefaults.standard.string(forKey: key)
        // Re-apply on every launch so AppleLanguages keeps overriding the
        // system locale even after the user kills and relaunches the app.
        if let lang = current {
            UserDefaults.standard.set([lang], forKey: "AppleLanguages")
        }
    }

    /// Set the preferred language. Pass `nil` to clear the override and
    /// follow the device's system language.
    ///
    /// The change to `AppleLanguages` only affects `Bundle.main` resolution
    /// on the **next launch**. To switch the running session immediately, the
    /// caller should also invoke the runtime bundle swap in
    /// `AppLanguage.swift` (`Bundle.applyLanguage(_:)`).
    func set(_ lang: String?) {
        current = lang
        UserDefaults.standard.set(lang, forKey: key)
        if let lang {
            UserDefaults.standard.set([lang], forKey: "AppleLanguages")
        } else {
            // Clearing the override: remove our AppleLanguages stamp so the
            // system's own locale order is used on next launch.
            UserDefaults.standard.removeObject(forKey: "AppleLanguages")
        }
    }
}
