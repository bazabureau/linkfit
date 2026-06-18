import SwiftUI

// =============================================================================
// REPORTS INTEGRATION HOOK
// -----------------------------------------------------------------------------
// This file documents how screens wire the shared ReportSheet into context
// menus. Profile, games, stories, feed comments, feed posts, and venue reviews
// already mount the sheet directly. New UGC surfaces should follow the same
// pattern below.
//
// USAGE (one-time per screen):
//
//   1. Hold a `@State private var reportPayload: ReportTargetPayload?` on
//      the host view (any view that can show a context menu / "..." button).
//
//   2. Add an item to the menu / long-press context that sets the payload:
//
//        Button(role: .destructive) {
//            reportPayload = ReportTargetPayload(
//                kind: .user,                        // or .game / .message
//                targetId: profile.id,
//                targetDisplayName: profile.display_name
//            )
//        } label: {
//            Label("reports.menu.report_user", systemImage: "flag")
//        }
//
//   3. Attach the sheet ONCE at the root of the host view tree:
//
//        .reportSheet(payload: $reportPayload)
//
//   The `reportSheet` modifier below handles VM construction, environment
//   plumbing, and dismissal — the host only owns the payload state.
//
// Existing target kinds:
//   - user, game, message, story, feed_event, feed_comment, venue_review, media
// =============================================================================

/// Payload the host view sets to trigger the sheet. Conforms to `Identifiable`
/// so it can drive a `.sheet(item:)` directly.
struct ReportTargetPayload: Identifiable, Equatable {
    /// Composite id — `(kind, targetId)` is unique enough that re-tapping
    /// the same row before dismissal won't re-present the sheet.
    var id: String { "\(kind.rawValue):\(targetId)" }
    let kind: ReportTargetKind
    let targetId: String
    let targetDisplayName: String?

    init(kind: ReportTargetKind, targetId: String, targetDisplayName: String? = nil) {
        self.kind = kind
        self.targetId = targetId
        self.targetDisplayName = targetDisplayName
    }
}

extension View {
    /// Mounts the `ReportSheet` on a screen. The host owns the binding and
    /// clears it (by setting to `nil`) when the sheet wants to dismiss.
    ///
    /// Reads the API client from `AppContainer` via the environment, so the
    /// host doesn't need to pass it in — they just need to be inside the
    /// app's environment tree (every screen mounted under `RootView` is).
    func reportSheet(payload: Binding<ReportTargetPayload?>) -> some View {
        modifier(ReportSheetMounter(payload: payload))
    }
}

private struct ReportSheetMounter: ViewModifier {
    @Binding var payload: ReportTargetPayload?
    @Environment(AppContainer.self) private var container

    func body(content: Content) -> some View {
        content.sheet(item: $payload) { p in
            ReportSheet(
                viewModel: ReportSheetViewModel(
                    apiClient: container.apiClient,
                    targetKind: p.kind,
                    targetId: p.targetId,
                    targetDisplayName: p.targetDisplayName
                )
            )
        }
    }
}
