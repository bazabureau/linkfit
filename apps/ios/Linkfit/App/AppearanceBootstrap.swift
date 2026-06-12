import SwiftUI
import UIKit

/// Single source of truth for the global UIKit appearance (nav bar +
/// tab bar). Previously this lived inside `HomeView.onAppear`, which
/// meant:
///
///   1. The first frame of any screen rendered BEFORE home appeared
///      used iOS's default (white) appearance, then snapped to the
///      lime-glass styling once home loaded.
///   2. Sheets that hosted their own `NavigationStack` (Conversations,
///      Notifications, BookCourt) could come up with the system
///      default if they presented before home's onAppear fired.
///   3. The "nav bar background disappears" report — the user opens
///      a deep link or a screen where home hadn't been visited yet,
///      and the bar shows blank because nothing configured its
///      `scrollEdgeAppearance` to include a blur effect.
///
/// The fix is to apply the appearance at `LinkfitApp.init()`, before
/// SwiftUI builds any view. `UINavigationBar.appearance()` and
/// `UITabBar.appearance()` are proxy objects: settings made here apply
/// to every instance that comes after.
///
/// iOS 17/26 detail: we set `scrollEdgeAppearance` to the SAME object
/// as `standardAppearance` (instead of leaving it nil). When they
/// differ, the system uses the scroll-edge variant at the top of any
/// scroll view, and the default scroll-edge variant on iOS 17+ is
/// fully transparent — which is exactly the "background disappears
/// when I scroll to top" symptom.
@MainActor
enum AppearanceBootstrap {

    static func configure() {
        configureNavigationBar()
        configureTabBar()
    }

    // MARK: - Nav bar

    private static func configureNavigationBar() {
        let appearance = UINavigationBarAppearance()
        // FULLY transparent nav bar — no blur, no tint, no hairline.
        // The user's hard requirement was "her yerde bu headerin boz
        // yigsdir olmasin hec yerde" (no grey header anywhere). With
        // `configureWithTransparentBackground()` AND explicitly
        // clearing backgroundEffect + backgroundColor, the mesh
        // gradient flows uninterrupted through the bar across every
        // screen in the app. iOS still reserves the safe-area height
        // for the bar, so toolbar items and back chevrons stay
        // tappable on top of the gradient.
        appearance.configureWithTransparentBackground()
        appearance.backgroundEffect = nil
        appearance.backgroundColor = .clear
        appearance.shadowColor = .clear
        appearance.titleTextAttributes = [
            .foregroundColor: UIColor(DSColor.textPrimary),
            .font: UIFont.systemFont(ofSize: 17, weight: .heavy),
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: UIColor(DSColor.textPrimary),
            .font: UIFont.systemFont(ofSize: 32, weight: .heavy),
        ]

        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        // iOS 17+ added a fourth slot. Without it, compact-height
        // screens at scroll edge fall back to the system default.
        if #available(iOS 17.0, *) {
            UINavigationBar.appearance().compactScrollEdgeAppearance = appearance
        }
        UINavigationBar.appearance().tintColor = UIColor(DSColor.accent)
    }

    // MARK: - Tab bar

    private static func configureTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithTransparentBackground()
        // Glass tab bar à la WhatsApp / Apple stock apps.
        appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialLight)
        appearance.backgroundColor = UIColor(DSColor.background).withAlphaComponent(0.4)
        // Soft hairline at top
        appearance.shadowColor = UIColor(DSColor.border)

        let item = UITabBarItemAppearance(style: .stacked)
        let accent = UIColor(DSColor.accent)
        item.selected.iconColor = accent
        item.selected.titleTextAttributes = [
            .foregroundColor: accent,
            .font: UIFont.systemFont(ofSize: 11, weight: .heavy),
        ]
        item.normal.iconColor = UIColor(DSColor.textSecondary).withAlphaComponent(0.6)
        item.normal.titleTextAttributes = [
            .foregroundColor: UIColor(DSColor.textSecondary).withAlphaComponent(0.6),
            .font: UIFont.systemFont(ofSize: 11, weight: .semibold),
        ]
        appearance.stackedLayoutAppearance = item
        appearance.inlineLayoutAppearance = item
        appearance.compactInlineLayoutAppearance = item

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}
