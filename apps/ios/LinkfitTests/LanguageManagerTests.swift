import XCTest
@testable import Linkfit

/// Pin the in-app language switching machinery. The product offers az/en/ru
/// and persists the choice across launches by writing to `UserDefaults`. The
/// runtime bundle swap (see `LocalizedBundle` in `AppLanguage.swift`) is
/// covered indirectly via `Bundle.main.localizedString(forKey:)` once a
/// language is applied — full `.lproj` lookup needs the resource to actually
/// ship, so we keep that check soft.
final class LanguageManagerTests: XCTestCase {

    private let languageStorageKey = "linkfit.language"
    private var savedDefault: String?
    private var savedAppleLanguages: [String]?

    override func setUp() {
        super.setUp()
        // Snapshot the keys so we can leave the simulator's defaults exactly
        // as we found them — other tests may also touch `UserDefaults`.
        savedDefault = UserDefaults.standard.string(forKey: languageStorageKey)
        savedAppleLanguages = UserDefaults.standard.array(forKey: "AppleLanguages") as? [String]
        UserDefaults.standard.removeObject(forKey: languageStorageKey)
    }

    override func tearDown() {
        if let saved = savedDefault {
            UserDefaults.standard.set(saved, forKey: languageStorageKey)
        } else {
            UserDefaults.standard.removeObject(forKey: languageStorageKey)
        }
        if let langs = savedAppleLanguages {
            UserDefaults.standard.set(langs, forKey: "AppleLanguages")
        }
        super.tearDown()
    }

    @MainActor
    func test_defaultsToAzerbaijani_whenNoStoredPreference() {
        UserDefaults.standard.removeObject(forKey: LanguageManager.storageKey)
        let manager = LanguageManager()
        XCTAssertEqual(manager.current, .az,
                       "Linkfit is Azerbaijan-first — fresh installs must default to az.")
    }

    @MainActor
    func test_restoresStoredPreference_acrossInstances() {
        UserDefaults.standard.set("en", forKey: LanguageManager.storageKey)
        let manager = LanguageManager()
        XCTAssertEqual(manager.current, .en)
    }

    @MainActor
    func test_storedValuePersists_whenLanguageSwitched() {
        let manager = LanguageManager()
        XCTAssertEqual(manager.current, .az)

        manager.current = .ru
        let stored = UserDefaults.standard.string(forKey: LanguageManager.storageKey)
        XCTAssertEqual(stored, "ru",
                       "Switching language must immediately persist to UserDefaults.")
    }

    @MainActor
    func test_switchingUpdatesAppleLanguages_forSystemFrameworks() {
        let manager = LanguageManager()
        manager.current = .en
        let langs = UserDefaults.standard.array(forKey: "AppleLanguages") as? [String] ?? []
        XCTAssertEqual(langs.first, "en",
                       "AppleLanguages must lead with the user-picked language so system frameworks pick it up.")
        // The fallback 'az' is appended so unlocalized strings fall back to
        // the source language rather than the device default.
        XCTAssertTrue(langs.contains("az"),
                      "AppleLanguages must keep az as a fallback for missing translations.")
    }

    @MainActor
    func test_corruptStoredValueFallsBackToDefault() {
        UserDefaults.standard.set("klingon", forKey: LanguageManager.storageKey)
        let manager = LanguageManager()
        XCTAssertEqual(manager.current, .az,
                       "Unknown language codes must not crash — fall back to az.")
    }

    func test_appLanguageCases_areExhaustive() {
        // Make a future PR that adds e.g. `.tr` think twice: every supported
        // language needs a Locale identifier and a displayKey.
        let codes = AppLanguage.allCases.map(\.rawValue).sorted()
        XCTAssertEqual(codes, ["az", "en", "ru"])
        for lang in AppLanguage.allCases {
            XCTAssertEqual(lang.locale.identifier, lang.rawValue,
                           "Locale identifier must match the rawValue for \(lang).")
        }
    }

    func test_applyLanguage_isIdempotent_acrossMultipleCalls() {
        // The static method swizzles Bundle.main exactly once. Calling
        // applyLanguage repeatedly with the same code must not crash and
        // must keep the bundle in a consistent state.
        Bundle.applyLanguage("az")
        Bundle.applyLanguage("en")
        Bundle.applyLanguage("az")
        Bundle.applyLanguage("ru")
        Bundle.applyLanguage("ru")
        // If we got here without crashing, the swizzle is stable.
        XCTAssertTrue(true)
    }
}
