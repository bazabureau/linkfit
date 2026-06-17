import Foundation

/// The five root destinations. Features reference `AppTab` to request a tab
/// switch without importing each other.
public enum AppTab: String, Sendable, CaseIterable, Hashable {
    case home, games, book, chat, profile
}

/// Cross-feature navigation seam. The app layer supplies concrete closures that
/// drive the real `NavigationStack`/`TabView`; features call them to navigate
/// without ever importing a sibling feature module. This is what keeps the
/// feature graph acyclic and each feature independently compilable.
///
/// `@MainActor` (navigation is UI) — which also makes the struct `Sendable`
/// despite holding non-`Sendable` closures.
@MainActor public struct Router: Sendable {
    public var switchTab: (AppTab) -> Void
    public var openGame: (String) -> Void
    public var openVenue: (String) -> Void
    public var openConversation: (String) -> Void
    public var openProfile: (String) -> Void

    public init(
        switchTab: @escaping (AppTab) -> Void = { _ in },
        openGame: @escaping (String) -> Void = { _ in },
        openVenue: @escaping (String) -> Void = { _ in },
        openConversation: @escaping (String) -> Void = { _ in },
        openProfile: @escaping (String) -> Void = { _ in }
    ) {
        self.switchTab = switchTab
        self.openGame = openGame
        self.openVenue = openVenue
        self.openConversation = openConversation
        self.openProfile = openProfile
    }
}
