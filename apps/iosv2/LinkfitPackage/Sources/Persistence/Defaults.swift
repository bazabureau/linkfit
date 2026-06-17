import Foundation

/// Typed, non-sensitive preferences. (Anything secret lives in the Keychain.)
/// Implemented as static accessors so it stays `Sendable`-free of stored state
/// and always reflects the live `UserDefaults`.
public enum Defaults {
    private enum Key {
        static let hasSeenOnboarding = "hasSeenOnboarding"
        static let appLockEnabled = "appLockEnabled"
        static let localeOverride = "localeOverride"
    }

    private static var store: UserDefaults { .standard }

    public static var hasSeenOnboarding: Bool {
        get { store.bool(forKey: Key.hasSeenOnboarding) }
        set { store.set(newValue, forKey: Key.hasSeenOnboarding) }
    }

    public static var appLockEnabled: Bool {
        get { store.bool(forKey: Key.appLockEnabled) }
        set { store.set(newValue, forKey: Key.appLockEnabled) }
    }

    /// "az" / "en" / "ru" or nil to follow the system language.
    public static var localeOverride: String? {
        get { store.string(forKey: Key.localeOverride) }
        set { store.set(newValue, forKey: Key.localeOverride) }
    }
}
