import Foundation

/// Audio/Haptic agent — invocation registry (documentation-only).
///
/// This file deliberately contains **no runtime calls into other
/// features**. It exists so a future contributor can grep for
/// `AudioHapticsHook` and immediately see where each effect *should*
/// be triggered from. Wiring it up is the responsibility of each
/// feature's view-model — the audio-haptic agent owns the catalog,
/// not the call sites.
///
/// To enable a hook, copy the suggested line into the feature's
/// view-model where the corresponding state transition happens. The
/// call is one line and never throws.
///
/// Convention: invoke *after* the optimistic UI update so the user
/// feels the confirmation in the same frame they see it.
enum AudioHapticsHook {
    /// Suggested invocation sites, keyed by effect. Format is the
    /// fully-qualified path the wiring contributor should edit.
    ///
    /// | Effect                | Suggested call site                                   |
    /// |-----------------------|-------------------------------------------------------|
    /// | `.gameJoined`         | `GameDetailViewModel.join()` after `success`           |
    /// | `.gameLeft`           | `GameDetailViewModel.leave()` after `success`          |
    /// | `.bookingConfirmed`   | `BookingViewModel.confirm()` on `.confirmed` state     |
    /// | `.messageReceived`    | `InboxViewModel.didReceive(message:)` (incoming only)  |
    /// | `.messageSent`        | `ConversationViewModel.send()` after optimistic insert |
    /// | `.achievementUnlocked`| `AchievementsViewModel.didUnlock(badge:)`              |
    /// | `.pointScored`        | `LiveScoreViewModel.increment()` (live-score views)    |
    /// | `.setWon`             | `LiveScoreViewModel.didCloseSet()`                     |
    /// | `.matchWon`           | `RatingFlowViewModel.submit()` when result == .win     |
    /// | `.matchLost`          | `RatingFlowViewModel.submit()` when result == .loss    |
    /// | `.error`              | Any view-model's `error` sink (toast bridge)           |
    /// | `.lightSelection`     | `FloatingTabBar` tab change, segmented control flips   |
    ///
    /// The one-line invocation at every site is identical:
    /// ```swift
    /// AudioHaptics.shared.play(.matchWon)
    /// ```
    ///
    /// Example wiring (pseudocode — DO NOT add until coordinated):
    /// ```swift
    /// // In RatingFlowViewModel.submit():
    /// switch outcome {
    /// case .win:  AudioHaptics.shared.play(.matchWon)
    /// case .loss: AudioHaptics.shared.play(.matchLost)
    /// }
    /// ```
    static let suggestedSites: [HapticEffect: String] = [
        .gameJoined:          "GameDetailViewModel.join()",
        .gameLeft:            "GameDetailViewModel.leave()",
        .bookingConfirmed:    "BookingViewModel.confirm()",
        .messageReceived:    "InboxViewModel.didReceive(message:)",
        .messageSent:         "ConversationViewModel.send()",
        .achievementUnlocked: "AchievementsViewModel.didUnlock(badge:)",
        .pointScored:         "LiveScoreViewModel.increment()",
        .setWon:              "LiveScoreViewModel.didCloseSet()",
        .matchWon:            "RatingFlowViewModel.submit() [result == .win]",
        .matchLost:           "RatingFlowViewModel.submit() [result == .loss]",
        .error:               "any view-model error sink",
        .lightSelection:      "FloatingTabBar tab change / segmented control",
    ]
}
