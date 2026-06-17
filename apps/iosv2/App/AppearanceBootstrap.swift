import SwiftUI
import UIKit
import DesignSystem

/// Global UIKit appearance for nav/tab chrome. Set once at launch so every
/// screen inherits the accent tint without per-view configuration.
enum AppearanceBootstrap {
    @MainActor static func apply() {
        let accent = UIColor(DSColor.accent)
        UIView.appearance().tintColor = accent

        let navBar = UINavigationBarAppearance()
        navBar.configureWithDefaultBackground()
        UINavigationBar.appearance().standardAppearance = navBar
        UINavigationBar.appearance().scrollEdgeAppearance = navBar
        UINavigationBar.appearance().compactAppearance = navBar
        UINavigationBar.appearance().tintColor = accent

        let tabBar = UITabBarAppearance()
        tabBar.configureWithDefaultBackground()
        UITabBar.appearance().standardAppearance = tabBar
        UITabBar.appearance().scrollEdgeAppearance = tabBar
    }
}
