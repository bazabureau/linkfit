import SwiftUI

struct OnboardingPage: Identifiable {
    let id: Int
    let imageName: String
    let imageAlignment: Alignment
    let kickerKey: LocalizedStringKey
    let headlineKey: LocalizedStringKey
    let subtitleKey: LocalizedStringKey
}

extension OnboardingPage {
    /// Canonical onboarding pages.
    ///
    /// `LocalizedStringKey` isn't `Sendable` under Swift 6 strict concurrency,
    /// so we expose this as a **computed** static property rather than a
    /// stored `static let`. The view materializes the array once per
    /// presentation, which is negligible for a 3-item array and avoids the
    /// Sendable shared-state warning.
    static var all: [OnboardingPage] {
        [
            OnboardingPage(
                id: 0,
                imageName: "OnboardHero1",
                imageAlignment: .center,
                kickerKey: "onboard.page1.kicker",
                headlineKey: "onboard.page1.headline",
                subtitleKey: "onboard.page1.subtitle"
            ),
            OnboardingPage(
                id: 1,
                imageName: "OnboardHero2",
                imageAlignment: .top,
                kickerKey: "onboard.page2.kicker",
                headlineKey: "onboard.page2.headline",
                subtitleKey: "onboard.page2.subtitle"
            ),
            OnboardingPage(
                id: 2,
                imageName: "OnboardHero3",
                imageAlignment: .center,
                kickerKey: "onboard.page3.kicker",
                headlineKey: "onboard.page3.headline",
                subtitleKey: "onboard.page3.subtitle"
            ),
        ]
    }
}
