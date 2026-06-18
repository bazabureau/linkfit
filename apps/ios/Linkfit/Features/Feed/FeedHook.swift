import SwiftUI

// =============================================================================
// FEED → HOME / PROFILE EMBED HOOK
// -----------------------------------------------------------------------------
// TODO(home-agent, profile-agent): Home and Profile are owned by other agents
// so this file only documents how to embed a feed preview card without
// touching those screens. Two embed shapes are supported:
//
//   1. STANDALONE TAB (recommended). Add a new tab to the shell:
//        case .feed:
//          NavigationStack(path: $feedPath) {
//            FeedView(
//              viewModel: FeedViewModel(apiClient: container.apiClient),
//              onTapTarget: { target in
//                switch target {
//                case .game(let id):       feedPath.append(HomeRoute.game(id))
//                case .tournament(let id): feedPath.append(HomeRoute.tournamentDetail(id))
//                case .profile(let id):    feedPath.append(HomeRoute.profile(id))
//                case .none: break
//                }
//              },
//              onFindPlayers: { rootTab = .players }
//            )
//          }
//
//   2. HOME PREVIEW CARD. Drop `FeedPreviewCard` (below) onto the Home
//      vertical stack between two existing sections. It shows the top 3
//      events and a "See all →" CTA that pushes onto Home's navigation
//      stack at `HomeRoute.feed` (a new case the Home agent should add).
//
// Why a hook file instead of touching Home/Profile directly:
//   - FILE OWNERSHIP. The feed agent does not modify other agents' views;
//     we only surface the entry-point shape so the owning agent picks it up
//     in their next pass.
//   - DECOUPLED ROUTING. The card never imports `HomeRoute`; it speaks
//     `FeedCardTarget` and lets the host translate. That keeps Feed
//     reusable from any NavigationStack.
// =============================================================================

/// Compact 3-row preview of the activity feed, suitable for embedding on
/// the Home screen between hero sections. Tapping the title row OR the
/// "See all" CTA fires `onSeeAll`; per-event taps go through
/// `onTapTarget` so the host can push into a detail view.
///
/// The viewModel is created lazily inside the card so callers don't have
/// to plumb one through — Home's `task` block can re-use the same client.
struct FeedPreviewCard: View {
    @State private var viewModel: FeedViewModel
    @State private var reportPayload: ReportTargetPayload?
    let onTapTarget: (FeedCardTarget) -> Void
    let onSeeAll: () -> Void
    /// Optional comments handler — when wired, each preview row exposes
    /// its "şərh" affordance and forwards the tapped event so the host
    /// can present `FeedCommentsSheet`. Optional with a safe default so
    /// existing embeds compile unchanged.
    let onTapComments: ((FeedEvent) -> Void)?

    init(apiClient: APIClient,
         onTapTarget: @escaping (FeedCardTarget) -> Void,
         onSeeAll: @escaping () -> Void,
         onTapComments: ((FeedEvent) -> Void)? = nil) {
        _viewModel = State(initialValue: FeedViewModel(apiClient: apiClient, pageSize: 5))
        self.onTapTarget = onTapTarget
        self.onSeeAll = onSeeAll
        self.onTapComments = onTapComments
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack {
                Text("feed.preview.title")
                    .font(.system(.headline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                Button(action: onSeeAll) {
                    Text("feed.preview.see_all")
                        .font(.system(.footnote, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                .buttonStyle(.plain)
            }

            switch viewModel.state {
            case .idle, .loading:
                LoadingView().frame(height: 120)
            case .empty:
                Text("feed.empty.message")
                    .font(.system(.footnote, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .padding(.vertical, DSSpacing.sm)
            case .error:
                EmptyView()
            case .loaded(let events):
                VStack(spacing: DSSpacing.xs) {
                    ForEach(events.prefix(3)) { event in
                        FeedEventCard(
                            event: event,
                            onTap: onTapTarget,
                            onTapComments: onTapComments.map { handler in
                                { handler(event) }
                            },
                            onReport: {
                                reportPayload = ReportTargetPayload(
                                    kind: .feed_event,
                                    targetId: event.id,
                                    targetDisplayName: event.actor.display_name
                                )
                            }
                        )
                    }
                }
            }
        }
        .task { await viewModel.onAppear() }
        .reportSheet(payload: $reportPayload)
    }
}

// MARK: - Suggested navigation route additions
//
// When the Home agent is ready to wire a feed tab or push destination, they
// should add a `case feed` (and optionally `case tournamentDetail(String)`
// if it doesn't exist yet) to `HomeRoute`:
//
//     enum HomeRoute: Hashable {
//         case game(String)
//         case profile(String)
//         case thread(String)
//         case feed                         // <-- new
//         case tournamentDetail(String)     // <-- if missing
//     }
//
// The destination view inside `HomeView.destinationView(for:)` then becomes:
//
//     case .feed:
//         FeedView(
//             viewModel: FeedViewModel(apiClient: container.apiClient),
//             onTapTarget: { target in
//                 switch target {
//                 case .game(let id):       path.append(HomeRoute.game(id))
//                 case .tournament(let id): path.append(HomeRoute.tournamentDetail(id))
//                 case .profile(let id):    path.append(HomeRoute.profile(id))
//                 case .none: break
//                 }
//             }
//         )
//
// The feed agent owns neither file — we leave the recipe here for the next
// pass on Home / shell.
