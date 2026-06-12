import SwiftUI

// Kept as a build-file compatibility stub until the generated Xcode project
// is refreshed. The app shell now uses native SwiftUI TabView navigation.
enum AppTab: Int, CaseIterable, Identifiable {
    // Note: the 4th tab is conceptually "notifications" now — chat moved to
    // the home header. The `chat` case symbol is kept so existing call sites
    // continue to compile without churn.
    case home, matches, tournaments, chat, profile

    static let discover      = AppTab.matches
    static let rankings      = AppTab.tournaments
    static let inbox         = AppTab.chat
    static let notifications = AppTab.chat

    var id: Int { rawValue }

    var icon: String {
        switch self {
        case .home:        return "house"
        case .matches:     return "figure.tennis"
        case .tournaments: return "trophy"
        case .chat:        return "bell"
        case .profile:     return "person.crop.circle"
        }
    }

    /// Filled SF Symbol variant used while the tab is selected. We swap
    /// the icon at render time so the active tab reads as "pressed in"
    /// instead of just changing color — Apple's own apps (Messages,
    /// Reminders, Music) all do this.
    var iconFilled: String {
        switch self {
        case .home:        return "house.fill"
        case .matches:     return "figure.tennis"   // no fill variant exists
        case .tournaments: return "trophy.fill"
        case .chat:        return "bell.fill"
        case .profile:     return "person.crop.circle.fill"
        }
    }

    var labelKey: LocalizedStringKey {
        switch self {
        case .home:        return "tab.home"
        case .matches:     return "tab.matches"
        case .tournaments: return "tab.tournaments"
        case .chat:        return "tab.notifications"
        case .profile:     return "tab.profile"
        }
    }

    var label: String {
        switch self {
        case .home:        return String(localized: "tab.home")
        case .matches:     return String(localized: "tab.matches")
        case .tournaments: return String(localized: "tab.tournaments")
        case .chat:        return String(localized: "tab.notifications")
        case .profile:     return String(localized: "tab.profile")
        }
    }
}
