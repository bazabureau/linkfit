import Foundation
import Observation
import SwiftUI
import UIKit
import UserNotifications

/// View-model for the four-slide post-signup activation tour.
///
/// The tour is a one-shot experience that runs the **first** time a user
/// lands on the authenticated shell after creating an account. Its job is to
/// translate "Linkfit is installed" into "Linkfit is set up to surface
/// padel partners" — i.e. the user has internalised the four core verbs
/// (find a game, build a squad, grow a rating, accept notifications) and,
/// crucially, has been asked for push permission while the value proposition
/// is fresh in their mind.
///
/// Persistence
/// -----------
/// The "I've seen the tour" flag lives under a stable `UserDefaults` key
/// (`Self.storageKey`) so the tour never re-appears on subsequent launches.
/// We use `UserDefaults.standard` rather than the keychain on purpose: a
/// fresh install — i.e. a user explicitly wiping the app — should re-show
/// the tour, which `UserDefaults` gives us for free.
///
/// The pre-signup marketing onboarding (`OnboardingView`, gated by
/// `linkfit.hasSeenOnboarding.v2`) is a *separate* flag — those two flows
/// surface back-to-back for a brand-new user but are persisted independently
/// so each can evolve without invalidating the other's "seen" state.
///
/// Concurrency
/// -----------
/// `@Observable` + `@MainActor`: SwiftUI bindings read `currentIndex` on the
/// main thread, and the notification-request hop into
/// `UNUserNotificationCenter` is awaited from main-actor context (the SDK is
/// thread-safe; we keep the view-model itself main-isolated to match
/// Linkfit's @Observable convention).
@Observable
@MainActor
final class OnboardingTourViewModel {
    // MARK: - Storage

    /// `UserDefaults` key. Exposed (`internal`) so tests can clear it and so
    /// the host shell (`AppShell`) can read the same constant without
    /// duplicating the string literal.
    static let storageKey = "onboarding.tour.completed"

    // MARK: - Static content

    /// The four slides, in display order. `LocalizedStringKey` is not
    /// `Sendable` under Swift 6 strict concurrency, so we expose this as a
    /// computed static rather than a stored `static let` — same trick used
    /// by `OnboardingPage.all` and `TutorialCard.all` elsewhere in this
    /// folder.
    static var slides: [OnboardingTourSlide] {
        [
            OnboardingTourSlide(
                id: 0,
                icon: "figure.tennis",
                titleKey: "onboarding.tour.slide1.title",
                bodyKey: "onboarding.tour.slide1.body"
            ),
            OnboardingTourSlide(
                id: 1,
                icon: "person.3.fill",
                titleKey: "onboarding.tour.slide2.title",
                bodyKey: "onboarding.tour.slide2.body"
            ),
            OnboardingTourSlide(
                id: 2,
                icon: "chart.line.uptrend.xyaxis",
                titleKey: "onboarding.tour.slide3.title",
                bodyKey: "onboarding.tour.slide3.body"
            ),
            OnboardingTourSlide(
                id: 3,
                icon: "bell.badge.fill",
                titleKey: "onboarding.tour.slide4.title",
                bodyKey: "onboarding.tour.slide4.body"
            )
        ]
    }

    // MARK: - State

    /// Currently visible slide. Bound to the `TabView`'s selection.
    var currentIndex: Int = 0

    /// Set to `true` once the tour has been finished or skipped. The view
    /// observes this and dismisses; the wrapper in `AppShell` mirrors it
    /// onto `UserDefaults` via its own binding so the dismissal is durable.
    private(set) var isComplete: Bool

    /// `true` while the system permission sheet is on screen. Used to
    /// disable the CTA so a double-tap can't re-fire the request.
    private(set) var isRequestingNotifications: Bool = false

    private let defaults: UserDefaults
    private let notificationCenter: UNUserNotificationCenter

    // MARK: - Init

    init(
        defaults: UserDefaults = .standard,
        notificationCenter: UNUserNotificationCenter = .current()
    ) {
        self.defaults = defaults
        self.notificationCenter = notificationCenter
        self.isComplete = defaults.bool(forKey: Self.storageKey)
    }

    // MARK: - Derived

    var slides: [OnboardingTourSlide] { Self.slides }

    /// `true` when the user is on the last slide. Drives the CTA copy switch
    /// (from "Növbəti" to "Bildirişlərə icazə ver").
    var isLastSlide: Bool {
        currentIndex == slides.count - 1
    }

    /// Localised key for the bottom CTA. The final slide pivots from a
    /// "next" label to a notification-permission action.
    var primaryCTAKey: LocalizedStringKey {
        isLastSlide ? "onboarding.tour.slide4.cta" : "onboarding.tour.next"
    }

    // MARK: - Actions

    /// Advance to the next slide, or — on the last slide — request push
    /// permission and then mark the tour complete regardless of the user's
    /// answer. We never block dismissal on a "no" because the rest of the
    /// app must remain usable without push (`PushRegistrar` already treats
    /// denied as a soft path).
    func advance() async {
        if isLastSlide {
            await requestNotificationsAndFinish()
        } else {
            currentIndex += 1
        }
    }

    /// Skip-pill action. Marks complete without requesting notifications —
    /// the user can grant them later via `PushRegistrar.start()` on their
    /// first authenticated session, or via iOS Settings.
    func skip() {
        markComplete()
    }

    /// Fire `UNUserNotificationCenter.requestAuthorization` and finalise.
    /// We treat any outcome — granted, denied, or thrown — as "the tour is
    /// done", because the dialog has been shown and re-prompting requires
    /// a Settings-app round-trip the user shouldn't be subjected to from
    /// onboarding. When granted, we also kick off APNs registration so the
    /// device-token round-trip starts immediately rather than waiting for
    /// the next cold launch.
    private func requestNotificationsAndFinish() async {
        guard !isRequestingNotifications else { return }
        isRequestingNotifications = true
        defer { isRequestingNotifications = false }

        do {
            let granted = try await notificationCenter.requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            if granted {
                // Trigger APNs registration so `PushRegistrar.didReceiveDeviceToken`
                // gets called and the token reaches the backend. Idempotent —
                // iOS dedupes repeat calls on the same token.
                UIApplication.shared.registerForRemoteNotifications()
            }
        } catch {
            // Parental controls / MDM can throw. Soft-fail: the app keeps
            // working without push. `PushRegistrar` will re-poll next launch.
        }

        markComplete()
    }

    /// Write the persistent flag and update the observable signal. Idempotent.
    private func markComplete() {
        guard !isComplete else { return }
        defaults.set(true, forKey: Self.storageKey)
        isComplete = true
    }
}

// MARK: - Slide model

/// One slide of the activation tour. Kept as a simple value type so the
/// view-model can hand a fully-rendered list to the SwiftUI `TabView`
/// without any per-slide branching at the call site.
struct OnboardingTourSlide: Identifiable, Equatable {
    let id: Int
    /// SF Symbol name shown inside the lime gradient hero circle.
    let icon: String
    let titleKey: LocalizedStringKey
    let bodyKey: LocalizedStringKey
}
