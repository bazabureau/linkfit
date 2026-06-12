import Foundation
import UIKit
import UserNotifications

// =============================================================================
// IN-APP NOTIFICATION NOTIFIER
// -----------------------------------------------------------------------------
// Bridges the SSE realtime channel into the global ToastCenter for ALL
// foreground notifications (follows, messages, game reminders, etc.).
//
// FLOW
// ----
// 1. App boot: `LinkfitApp.task` calls `InAppNotificationNotifier.shared.start(...)`
//    once the AppContainer (and therefore `realtime`) is in scope.
// 2. We subscribe to a fresh `realtime.subscribe()` stream and pull events
//    inside a long-lived Task on the main actor.
// 3. Every notification frame triggers a `ToastCenter.shared.info(...)` toast.
//
// CONVERSATION FOCUS SUPPRESSION
// ------------------------------
// When a user opens a DM or group chat thread, `activeConversationId` is set
// to that conversation's ID. If a `message_received` notification event arrives
// for that exact conversation, we suppress the toast to avoid cluttering the
// active conversation screen.
// =============================================================================

@MainActor
final class InAppNotificationNotifier {
    /// Process-wide singleton. Toast routing is inherently UI-global,
    /// and we want the call site (`LinkfitApp.task`) to be one line.
    static let shared = InAppNotificationNotifier()

    /// Long-lived pump task. Captured so `stop()` (and the idempotent
    /// guard in `start`) can locate / cancel it.
    private var pumpTask: Task<Void, Never>?

    /// Currently opened conversation ID in the UI. When set, any incoming message
    /// notifications for this thread are suppressed so we don't display a toast banner.
    var activeConversationId: String?

    private init() {}

    /// Begin observing the realtime stream and dispatch in-app toasts.
    /// Idempotent — calling twice while the pump is already running is
    /// a no-op.
    func start(realtime: RealtimeClient) {
        if let pumpTask, !pumpTask.isCancelled {
            return
        }
        pumpTask = Task { @MainActor in
            let stream = await realtime.subscribe()
            for await event in stream {
                self.handle(event)
            }
            self.pumpTask = nil
        }
    }

    /// Cancel the pump.
    func stop() {
        pumpTask?.cancel()
        pumpTask = nil
    }

    // MARK: - Event handling

    private func handle(_ event: RealtimeEvent) {
        // We only act on `.notification(payload)` frames. Message events
        // (`.message`) are owned by the inbox view-models; unknown
        // kinds are ignored or logged.
        guard case .notification(let payload) = event else { return }

        // Suppress message_received if the user is currently inside that conversation thread
        if payload.type.caseInsensitiveCompare("message_received") == .orderedSame {
            if let conversationId = payload.payload?.conversation_id,
               conversationId == activeConversationId {
                return
            }
        }

        // Format combined Title: Body for premium in-app toasts
        let message: String = {
            let title = payload.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let body = payload.body.trimmingCharacters(in: .whitespacesAndNewlines)
            if !title.isEmpty && !body.isEmpty {
                return "\(title): \(body)"
            } else if !body.isEmpty {
                return body
            } else if !title.isEmpty {
                return title
            } else {
                return String(localized: "notifications.title")
            }
        }()

        ToastCenter.shared.info(message)
    }
}
