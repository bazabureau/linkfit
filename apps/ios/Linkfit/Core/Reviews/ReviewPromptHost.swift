import StoreKit
import SwiftUI

/// Mounts the bridge between `ReviewPromptCoordinator` (a non-View
/// `@Observable` singleton) and SwiftUI's iOS 18 `requestReview`
/// environment action.
///
/// The coordinator can't invoke `requestReview` directly — it lives in
/// `EnvironmentValues` and is only reachable inside a View's body. So the
/// coordinator flips its `shouldPrompt` flag, this modifier observes the
/// change in `.onChange`, calls the action, and immediately tells the
/// coordinator to record the timestamp + reset the counter via
/// `didPrompt()`. That keeps the eligibility logic out of the view layer
/// and confines this file to a pure transport role.
///
/// Apply once at the scene root in `LinkfitApp.swift` — see
/// `.reviewPromptHost()`. Mounting it deeper is harmless but redundant;
/// mounting it twice would fire the request twice for the same edge,
/// which is why it lives at the root.
///
/// TODO(wiring): call `ReviewPromptCoordinator.shared.recordPositiveMoment()`
/// from the successful game-finalize path and from the "5+ messages sent in
/// a single conversation" milestone. Held off as a follow-up so this PR
/// doesn't conflict with parallel agents touching the game and chat
/// feature dirs.
struct ReviewPromptHost: ViewModifier {

    // iOS 18+ — `requestReview` is the modern, SwiftUI-native successor to
    // `SKStoreReviewController.requestReview`. Calling the action posts the
    // standard system review sheet (or silently no-ops if the user has
    // already been asked recently, per Apple's own throttle).
    @Environment(\.requestReview) private var requestReview

    // Observed by reference — `ReviewPromptCoordinator` is `@Observable`
    // and the singleton instance never changes for the lifetime of the
    // app, so `@State` here is just a stable handle. Mutations to
    // `shouldPrompt` invalidate this body and re-run `.onChange`.
    @State private var coordinator = ReviewPromptCoordinator.shared

    func body(content: Content) -> some View {
        content
            // Watch for the rising edge of `shouldPrompt`. We don't need
            // the falling edge — the coordinator clears the flag itself
            // inside `didPrompt()`, and observing `false` would just be a
            // redundant no-op.
            .onChange(of: coordinator.shouldPrompt) { _, shouldPrompt in
                guard shouldPrompt else { return }
                requestReview()
                // Acknowledge synchronously: stamp the prompt date, reset
                // the counter, lower the edge. Done immediately rather
                // than after a delay because `requestReview` returns
                // without a completion handler and we have no way of
                // knowing when/if the sheet actually appeared. Treat the
                // intent-to-ask as the commit point.
                coordinator.didPrompt()
            }
    }
}

extension View {
    /// Mount the review-prompt bridge at the scene root. See
    /// `ReviewPromptHost` for the rationale on why this lives at the root
    /// (single edge dispatch per eligible moment).
    func reviewPromptHost() -> some View {
        modifier(ReviewPromptHost())
    }
}
