import Foundation
import SwiftUI

/// Coordinates "ask the user to leave an App Store review" prompts.
///
/// StoreKit's review request is rate-limited by the system (Apple caps it
/// to ~3 per 365 days regardless of what we ask), so the worst case from
/// over-firing is a silent no-op — but we still don't want to burn one of
/// those slots on a frustrated user or a brand-new install. To avoid that,
/// we:
///
/// 1. Only call `requestReview` after the caller has recorded a *positive*
///    moment (game finalized cleanly, an engaged chat session). Negative
///    or neutral surfaces never trip the prompt.
/// 2. Require at least 3 positive moments before the first ask — single
///    happy events aren't enough; we want a pattern of satisfaction.
/// 3. Hold a 90-day cooldown between asks, persisted across launches.
///    This is stricter than Apple's own throttle so we don't *spend* our
///    365-day budget needlessly.
///
/// State (positive-moment counter + last prompt date) lives in
/// `UserDefaults.standard` so it survives relaunches but resets on app
/// reinstall — which is fine; a reinstalled user is effectively new.
///
/// The coordinator can't invoke the iOS 18 `requestReview` action itself
/// because that action is an `@Environment` value and only reachable from a
/// SwiftUI `View`. Instead the coordinator flips `shouldPrompt = true` and
/// `ReviewPromptHost` (the view modifier mounted at the scene root)
/// observes that flag, performs the request, then calls back into
/// `didPrompt()` to record the timestamp and reset the counter.
///
/// `@Observable` + `@MainActor` mirrors `ToastCenter` / `ThemeManager` —
/// SwiftUI views pick up `shouldPrompt` changes without any `@Published`
/// shim, and all UserDefaults reads/writes are serialized on the main
/// actor (the data is tiny, so this is not a contention concern).
@Observable
@MainActor
final class ReviewPromptCoordinator {

    // Singleton — review state is inherently app-global and the StoreKit
    // request is a UI side-effect; injecting per-scene instances would
    // mean every feature has to thread an environment object just to log
    // a happy moment.
    static let shared = ReviewPromptCoordinator()

    // MARK: - Tunables

    /// Minimum number of positive moments before we even consider asking.
    /// Chosen to require sustained satisfaction, not a single lucky game.
    private let momentThreshold: Int = 3

    /// Days between consecutive review prompts. Stricter than Apple's own
    /// 365-day / 3-prompt throttle so we conserve the system budget.
    private let cooldownDays: Int = 90

    // MARK: - UserDefaults keys
    //
    // Namespaced with `Linkfit` so a future feature can't accidentally
    // collide. Keys are stable strings — never derive them from
    // type names, since renaming the coordinator would silently reset
    // every user's counter.
    private enum Keys {
        static let moments = "LinkfitReviewMoments"
        static let lastPromptDate = "LinkfitReviewLastPromptDate"
    }

    // MARK: - Observed state

    /// Flips to `true` when `maybePromptForReview()` decides we're eligible
    /// to ask. `ReviewPromptHost` observes this and triggers the StoreKit
    /// action, then immediately calls `didPrompt()` which flips it back.
    /// Kept as a one-shot edge rather than a continuous signal so the
    /// modifier's `.onChange` fires exactly once per eligible moment.
    private(set) var shouldPrompt: Bool = false

    private let defaults: UserDefaults

    // MARK: - Init

    /// Designated init takes a `UserDefaults` so tests can inject an
    /// in-memory suite. Production callers use `.shared`, which binds to
    /// `.standard`.
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Public API

    /// Record a positive in-app moment.
    ///
    /// Call sites: successful match-score finalize, 5+ messages in a
    /// single conversation, or any other "user just had a good time"
    /// event. Cheap (one UserDefaults int write) — safe to call from hot
    /// paths.
    func recordPositiveMoment() {
        let current = defaults.integer(forKey: Keys.moments)
        defaults.set(current + 1, forKey: Keys.moments)
    }

    /// Evaluate whether the user is eligible for a review prompt and, if
    /// so, raise `shouldPrompt`. The view-level host then performs the
    /// actual `requestReview` call.
    ///
    /// Safe to call repeatedly — if we're inside the cooldown window or
    /// below the moment threshold, this is a no-op. Idempotent within a
    /// single eligibility window: once we've flipped `shouldPrompt` we
    /// don't flip it again until the host acknowledges via `didPrompt()`.
    func maybePromptForReview() {
        // Already armed — host hasn't processed the last edge yet. Don't
        // double-fire; the next `.onChange` would no-op anyway, but a
        // clean guard makes the intent obvious.
        guard !shouldPrompt else { return }

        let moments = defaults.integer(forKey: Keys.moments)
        guard moments >= momentThreshold else { return }

        if let last = defaults.object(forKey: Keys.lastPromptDate) as? Date {
            // `cooldownDays` is computed as a real time interval (in
            // seconds) rather than `Calendar.dateComponents(.day:)` so
            // DST transitions and timezone changes can't accidentally
            // shorten the window by a few hours.
            let cooldown = TimeInterval(cooldownDays) * 24 * 60 * 60
            guard Date().timeIntervalSince(last) >= cooldown else { return }
        }

        shouldPrompt = true
    }

    /// Called by `ReviewPromptHost` immediately after invoking the
    /// StoreKit prompt. Records the timestamp, resets the counter, and
    /// lowers the edge so the next eligibility check starts from zero.
    ///
    /// Note: we record `lastPromptDate` *regardless* of whether the
    /// system actually showed the dialog — Apple's API gives no callback
    /// for that, and even a suppressed request still "counts" toward our
    /// intent to not pester the user. Worst case the user sees a prompt
    /// at most once per 90 days even when StoreKit silently swallowed
    /// the previous ask.
    func didPrompt() {
        defaults.set(Date(), forKey: Keys.lastPromptDate)
        defaults.set(0, forKey: Keys.moments)
        shouldPrompt = false
    }
}
