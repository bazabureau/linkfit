// LiveActivityCoordinator.swift
//
// LiveActivity agent — start / update / end facade.
//
// Wraps `ActivityKit`'s `Activity<MatchActivityAttributes>` API behind a
// small actor so the rest of the app:
//
//   1. Never has to import ActivityKit.
//   2. Gets a single, serialised entry point for all activity mutation
//      (no races where two view models call `update` in the same tick).
//   3. Handles the "user disabled Live Activities" case gracefully —
//      `start(...)` simply returns `nil` instead of throwing, so call
//      sites can keep going without try/catch sprawl.
//
// The Scoring agent's view models invoke this via the contract in
// `LiveActivityHook.swift`. The coordinator never reads from the
// network and never imports any feature module.

@preconcurrency import ActivityKit
import Foundation
import os

/// Single entry point for the app to drive the match Live Activity.
///
/// `ActivityKit`'s API surface is `@MainActor`-isolated, so the coordinator
/// runs on the main actor too. The `Sendable` shape of our types (the
/// generated `ContentState` is Codable + struct, so Sendable) keeps the
/// integration with the actor-based Scoring view models clean.
@MainActor
public final class LiveActivityCoordinator {

    public static let shared = LiveActivityCoordinator()

    private let log = Logger(subsystem: "az.linkfit.app", category: "LiveActivity")

    private init() {}

    // MARK: - Lifecycle

    /// Request a new Live Activity for a match.
    ///
    /// - Returns: the live `Activity` handle, or `nil` if Live
    ///   Activities are disabled, unsupported on the device, or the
    ///   system rejects the request (rate limit, missing entitlement).
    ///
    /// The function is intentionally non-throwing for the *permission*
    /// failure path: callers (view models) can simply `await` and move
    /// on. Genuine `ActivityKit` errors are logged but not re-raised,
    /// because the app's primary surface is unaffected by their failure.
    @discardableResult
    public func start(
        attributes: MatchActivityAttributes,
        initialState: MatchActivityAttributes.ContentState
    ) async -> Activity<MatchActivityAttributes>? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            log.notice("Live Activities disabled by the user; skipping start.")
            return nil
        }

        let content = ActivityContent(
            state: initialState,
            staleDate: nil,
            relevanceScore: 100
        )

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            log.info("Started live activity \(activity.id, privacy: .public)")
            return activity
        } catch {
            log.error("Failed to start live activity: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Push a new score snapshot to a running activity.
    ///
    /// Silently no-ops if no activity matches `activityId` — that is
    /// the expected outcome when the user has dismissed the banner.
    public func update(
        activityId: String,
        state: MatchActivityAttributes.ContentState
    ) async {
        guard let activity = activity(for: activityId) else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        await activity.update(content)
    }

    /// Push a final snapshot and tear down the activity.
    ///
    /// The final content stays visible on the lock screen for a few
    /// minutes (Apple's default `dismissalPolicy`), then the system
    /// removes it. Passing `.immediate` would yank it instantly; the
    /// default is friendlier for score recap.
    public func end(
        activityId: String,
        final: MatchActivityAttributes.ContentState
    ) async {
        guard let activity = activity(for: activityId) else { return }
        let content = ActivityContent(state: final, staleDate: nil)
        await activity.end(content, dismissalPolicy: .default)
    }

    /// End every currently-running match activity. Useful on logout.
    public func endAll() async {
        for activity in Activity<MatchActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    // MARK: - Helpers

    private func activity(for id: String) -> Activity<MatchActivityAttributes>? {
        Activity<MatchActivityAttributes>.activities.first { $0.id == id }
    }
}
