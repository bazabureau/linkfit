import SwiftUI

/// Supported in-app languages. The user picks one; SwiftUI's environment is
/// set with the chosen Locale so every `Text("key")` resolves against that
/// language regardless of the device's system language, AND `Bundle.main`
/// is swapped to the matching `.lproj` so `String(localized:)` /
/// `NSLocalizedString` also respect the choice.
enum AppLanguage: String, CaseIterable, Identifiable {
    case az, en, ru
    var id: String { rawValue }

    var displayKey: LocalizedStringKey {
        switch self {
        case .az: return "settings.language.az"
        case .en: return "settings.language.en"
        case .ru: return "settings.language.ru"
        }
    }

    var locale: Locale { Locale(identifier: rawValue) }
}

@Observable
@MainActor
final class LanguageManager {
    var current: AppLanguage {
        didSet {
            UserDefaults.standard.set(current.rawValue, forKey: Self.storageKey)
            Bundle.applyLanguage(current.rawValue)
            // Also nudge AppleLanguages so any system framework that reads
            // it picks up the new preference.
            UserDefaults.standard.set([current.rawValue, "az"], forKey: "AppleLanguages")
        }
    }

    static let storageKey = "linkfit.language"

    init() {
        if let raw = UserDefaults.standard.string(forKey: Self.storageKey),
           let lang = AppLanguage(rawValue: raw) {
            self.current = lang
        } else {
            self.current = .az
        }
        Bundle.applyLanguage(self.current.rawValue)
    }
}

// MARK: - Runtime bundle swap

/// Replace `Bundle.main` with a custom bundle subclass whose
/// `localizedString(forKey:value:table:)` reads from the chosen `.lproj`.
/// This is the canonical iOS approach for in-app language switching —
/// system frameworks and `NSLocalizedString` / `String(localized:)` all
/// route through `Bundle.main`, so swapping it covers every call site.
extension Bundle {
    nonisolated(unsafe) private static var hasSwizzled = false

    static func applyLanguage(_ code: String) {
        if !hasSwizzled {
            object_setClass(Bundle.main, LocalizedBundle.self)
            hasSwizzled = true
        }
        if let path = Bundle.main.path(forResource: code, ofType: "lproj"),
           let bundle = Bundle(path: path) {
            objc_setAssociatedObject(Bundle.main,
                                     &LocalizedBundle.languageBundleKey,
                                     bundle,
                                     .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        } else {
            objc_setAssociatedObject(Bundle.main,
                                     &LocalizedBundle.languageBundleKey,
                                     nil,
                                     .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
    }
}

private final class LocalizedBundle: Bundle, @unchecked Sendable {
    nonisolated(unsafe) static var languageBundleKey: UInt8 = 0

    override func localizedString(forKey key: String,
                                  value: String?,
                                  table tableName: String?) -> String {
        if let bundle = objc_getAssociatedObject(self, &Self.languageBundleKey) as? Bundle {
            return bundle.localizedString(forKey: key, value: value, table: tableName)
        }
        return super.localizedString(forKey: key, value: value, table: tableName)
    }
}
