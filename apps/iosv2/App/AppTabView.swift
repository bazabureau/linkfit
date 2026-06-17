import SwiftUI
import AppCore
import Models
import DesignSystem

/// The signed-in shell: five native tabs, each its own `NavigationStack`.
/// Placeholder content for Phase 0 — feature root views replace these per phase.
struct AppTabView: View {
    let container: AppContainer
    let user: User
    @State private var tab: AppTab = .home

    var body: some View {
        TabView(selection: $tab) {
            Tab("tab.home", systemImage: "house.fill", value: AppTab.home) {
                NavigationStack { HomePlaceholder(user: user) }
            }
            Tab("tab.games", systemImage: "figure.tennis", value: AppTab.games) {
                NavigationStack { TabPlaceholder(titleKey: "tab.games", icon: "figure.tennis") }
            }
            Tab("tab.book", systemImage: "calendar", value: AppTab.book) {
                NavigationStack { TabPlaceholder(titleKey: "tab.book", icon: "calendar") }
            }
            Tab("tab.chat", systemImage: "bubble.left.and.bubble.right.fill", value: AppTab.chat) {
                NavigationStack { TabPlaceholder(titleKey: "tab.chat", icon: "bubble.left.and.bubble.right.fill") }
            }
            Tab("tab.profile", systemImage: "person.fill", value: AppTab.profile) {
                NavigationStack { ProfilePlaceholder(user: user, session: container.session) }
            }
        }
        .tint(DSColor.accent)
    }
}
