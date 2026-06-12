import SwiftUI

// MARK: - Group chat entry-point glue
//
// `GameDetailView` and `TournamentDetailView` are owned by other agents
// and frozen for this work — instead of editing them, we expose two tiny,
// drop-in SwiftUI views that those screens can mount when they want a
// "Group chat" button.
//
// Integration sketch (recommended next agent):
//
//   // Inside GameDetailView, near the join button:
//   GroupChatHook.GameButton(
//       gameId: viewModel.game.id,
//       isMember: viewModel.iAmConfirmedParticipant,
//       onOpen: { conversationId in
//           // Push to the existing group-thread route. If the host wires up a
//           // dedicated route for group chats, use that; otherwise reuse
//           // HomeRoute.thread(conversationId) — the conversation_id is
//           // routable through the same ConversationThreadView shell, but
//           // the GroupConversationView gives a better UX (see below).
//           navigationPath.append(HomeRoute.thread(conversationId))
//       })
//
//   // Inside TournamentDetailView, near the squad list when the viewer is a captain:
//   GroupChatHook.TournamentButton(
//       tournamentId: viewModel.tournament.id,
//       isCaptain: viewModel.viewerIsRegisteredCaptain,
//       onOpen: { conversationId in
//           navigationPath.append(HomeRoute.thread(conversationId))
//       })
//
// The button auto-resolves the `conversation_id` (idempotent POST) when
// tapped — `GameDetailView` doesn't need to know about the group-chat API.
// If the user isn't allowed to open the group (not a participant / not a
// captain) the button is hidden, so we don't have to ship a "Join first"
// affordance there.

enum GroupChatHook {

    /// Mounts a pill-button that opens the game's group conversation. Hidden
    /// when the viewer isn't a confirmed participant.
    struct GameButton: View {
        let gameId: String
        let isMember: Bool
        let onOpen: (String) -> Void
        @Environment(AppContainer.self) private var container

        @State private var loading = false

        var body: some View {
            if isMember {
                Button {
                    Task { await openGroup() }
                } label: {
                    HStack(spacing: 8) {
                        if loading {
                            ProgressView().controlSize(.small).tint(DSColor.accent)
                        } else {
                            Image(systemName: "person.3.fill")
                        }
                        Text("group_chat.open_for_game")
                            .font(.system(.subheadline, design: .default, weight: .semibold))
                    }
                    .foregroundStyle(DSColor.accent)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .background(
                        Capsule().fill(DSColor.accent.opacity(0.12)))
                }
                .buttonStyle(.plain)
                .disabled(loading)
            } else {
                EmptyView()
            }
        }

        private func openGroup() async {
            loading = true
            defer { loading = false }
            do {
                let id = try await GroupConversationViewModel.resolveConversationId(
                    apiClient: container.apiClient,
                    kind: .game,
                    targetId: gameId)
                onOpen(id)
            } catch {
                // Surface nothing here — the screen can show a toast later.
            }
        }
    }

    /// Mounts a pill-button that opens the tournament's group conversation.
    /// Hidden when the viewer isn't a captain of any registered squad.
    struct TournamentButton: View {
        let tournamentId: String
        let isCaptain: Bool
        let onOpen: (String) -> Void
        @Environment(AppContainer.self) private var container

        @State private var loading = false

        var body: some View {
            if isCaptain {
                Button {
                    Task { await openGroup() }
                } label: {
                    HStack(spacing: 8) {
                        if loading {
                            ProgressView().controlSize(.small).tint(DSColor.accent)
                        } else {
                            Image(systemName: "person.3.fill")
                        }
                        Text("group_chat.open_for_tournament")
                            .font(.system(.subheadline, design: .default, weight: .semibold))
                    }
                    .foregroundStyle(DSColor.accent)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .background(
                        Capsule().fill(DSColor.accent.opacity(0.12)))
                }
                .buttonStyle(.plain)
                .disabled(loading)
            } else {
                EmptyView()
            }
        }

        private func openGroup() async {
            loading = true
            defer { loading = false }
            do {
                let id = try await GroupConversationViewModel.resolveConversationId(
                    apiClient: container.apiClient,
                    kind: .tournament,
                    targetId: tournamentId)
                onOpen(id)
            } catch {
                // Swallow — the captain can retry.
            }
        }
    }
}
