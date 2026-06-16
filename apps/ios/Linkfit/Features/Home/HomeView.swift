import SwiftUI
import Observation

struct HomeView: View {
    @State var viewModel: HomeViewModel
    @State private var shell = HomeShellViewModel(apiClient: HomeNullClient())
    @State private var venues = VenuesViewModel(apiClient: HomeNullClient())
    @State private var tournaments = TournamentsViewModel(apiClient: HomeNullClient())
    // Per-tab VMs lifted out of `nativeTabs` so they aren't reconstructed
    // on every parent body re-render. HomeView observes ~5 sources + has
    // 10+ `@State` so re-renders are frequent; recreating these on each
    // pass burned cycles and broke any state the tab VM held. Pattern
    // mirrors `shell`/`venues`/`tournaments` above — stub-init here,
    // re-bind to the real APIClient inside `.task`. `profile` is
    // optional because `ProfileViewModel` requires a non-nil
    // `AppContainer` and there's no stub for it (it's `@MainActor`
    // + `private init`); we instantiate it on the first `.task` pass
    // once `@Environment(AppContainer.self)` resolves.
    @State private var matches = MatchesViewModel(apiClient: HomeNullClient(), currentUserId: nil)
    @State private var profile: ProfileViewModel?
    @Environment(AppContainer.self) private var container
    @Environment(VersionGateModel.self) private var versionGate
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Soft-update banner is session-local — once the user dismisses
    /// it (or taps Update), they don't see it again until the app
    /// is relaunched. Stored as plain `@State` (not `@AppStorage`)
    /// so a real version bump triggers the banner on next launch.
    @State private var didDismissUpdateBanner: Bool = false

    // One NavigationPath per tab — canonical iOS 26 pattern. Putting a
    // single path on an outer NavigationStack that wraps a TabView
    // mixes navigation across tabs and breaks the native nav bar
    // (toolbar items + large titles collapse to zero height). With
    // per-tab paths each tab owns its own stack, the toolbar renders
    // properly, and a back-swipe in one tab no longer pops a stack in
    // another.
    @State private var homePath = NavigationPath()
    @State private var matchesPath = NavigationPath()
    @State private var tournamentsPath = NavigationPath()
    @State private var profilePath = NavigationPath()
    /// Dedicated path for the chat sheet's internal NavigationStack so
    /// tapping a conversation pushes the thread INSIDE the sheet (no
    /// race against the parent dismiss animation).
    @State private var chatPath = NavigationPath()
    /// Same idea for the notifications sheet — tapping a row pushes
    /// the relevant destination onto this stack rather than racing a
    /// dismiss against the parent path.
    @State private var notificationsPath = NavigationPath()
    @State private var activeTab: AppTab = .home
    @State private var showCreate = false
    @State private var showBookCourt = false
    @State private var showChat = false
    @State private var showNotifications = false
    /// Drives the global search sheet. Toggled from the
    /// `magnifyingglass` toolbar icon next to the bell. SearchView is
    /// presented inside its own NavigationStack (similar pattern to
    /// the chat sheet) so internal "see all" pushes stay inside the
    /// sheet rather than racing the parent dismiss.
    @State private var showSearch = false
    @State private var joinedGameIds = Set<String>()

    @State private var primaryElo: Int?
    @State private var gamesPlayed: Int = 0
    @State private var gamesWon: Int = 0
    /// Cached list of nearby players for the home discovery carousel.
    /// Reloads alongside games on pull-to-refresh. Empty until the
    /// first `loadPlayers()` call resolves.
    @State private var nearbyPlayers: [PlayerSummary] = []
    /// Tracks whether the first `loadNearbyPlayers()` has resolved so
    /// we can show a skeleton on cold load (rather than flashing the
    /// "no players nearby" empty card for the second it takes the
    /// request to return).
    @State private var nearbyPlayersLoaded: Bool = false

    // Announcements (W10-12) — slim top banner driven by a server-side
    // broadcast queue (`/api/v1/me/announcements`). VM is stub-init'd
    // here so the @State is valid at view-construction time, then
    // re-bound to the real APIClient inside `.task` (same pattern as
    // `shell`, `venues`, etc). The VM's `current` is `nil` until the
    // first `load()` resolves, so the banner slot stays collapsed
    // until there's something to surface.
    @State private var announcements = AnnouncementsViewModel(apiClient: HomeNullClient())

    // Stories — rail on top of HomeView (FAZA: stories agent). The rail
    // VM is initialised with a stub client and re-bound with the real
    // `container.apiClient` inside `.task` (same pattern as `shell`,
    // `venues`, `tournaments`). `presentedStoryGroup` drives the
    // `.fullScreenCover` for the viewer; `showStoryCreator` drives the
    // creator cover. Two pieces of state because the user can open the
    // viewer then tap the close button without ever touching the
    // creator, and vice versa.
    @State private var storiesRail = StoriesRailViewModel(apiClient: HomeNullClient())
    @State private var presentedStoryGroup: StoryGroup?
    @State private var showStoryCreator: Bool = false


    /// Holds the freshly-created game's id so we can present the
    /// post-create invite sheet (followers multi-select). `nil` when no
    /// such sheet is pending; setting this to a non-nil id triggers the
    /// item-bound `.sheet(item:)` modifier below. We use the dedicated
    /// state (rather than a Bool) so the sheet's view-model can be
    /// constructed lazily with the right gameId at present-time, not
    /// re-built on every HomeView re-render.
    @State private var postCreateInviteFor: PostCreateInvitePayload?
    /// Wave-11 deferred-present payload — staged BEFORE CreateGameView
    /// dismisses so the create-sheet's `onDismiss` can flip it to the
    /// active `postCreateInviteFor` once the first sheet's animation
    /// completes. SwiftUI refuses to stack two sheets on the same
    /// view; if we set `postCreateInviteFor` in the same frame as
    /// `showCreate = false` the second sheet silently never presents
    /// — the bug the user reported as "Yeni yaranan oyunlar üçün
    /// dəvət göndərmək olmur". Two-step staging fixes it cleanly.
    @State private var pendingPostCreateInvite: PostCreateInvitePayload?

    /// Which tab the Inbox sheet (bell icon) is showing. Defaults to
    /// notifications; deep-link routing flips it to `.invitations` so a
    /// `game_invite` push lands on the right surface. Lives on
    /// HomeView (not InboxView) so we can drive it from outside the
    /// sheet (push handler, etc).
    @State private var inboxTab: InboxView.Tab = .notifications
    /// Lazy view-models for the Inbox tabs. Built once on first present
    /// so flipping tabs doesn't burn fresh network calls; the
    /// notifications VM was previously rebuilt each present (cheap, but
    /// the invitations VM holds optimistic state we'd rather not lose).
    @State private var inboxNotificationsVM: NotificationsViewModel?
    @State private var inboxInvitationsVM: InvitationsViewModel?

    /// Drives the feed comments sheet (`FeedCommentsSheet`) for the
    /// "Friend activity" mini-section. Holds the tapped event's id so the
    /// sheet's view-model can be constructed lazily with the right
    /// `eventId` at present-time (item-bound `.sheet(item:)`). `nil` when
    /// no comments sheet is pending. Without this wiring the whole
    /// comments feature was unreachable from home — the card rendered the
    /// "şərh" affordance only when `onTapComments` was non-nil, and it
    /// never was.
    @State private var commentsEventId: FeedCommentsTarget?

    var body: some View {
        nativeTabs
            .sheet(isPresented: $showCreate, onDismiss: {
                // CreateGameView finished dismissing — NOW we can present
                // the post-create invite sheet safely. SwiftUI doesn't
                // allow two sheets to be presented from the same view
                // simultaneously; staging the payload on `onCreated` and
                // activating it here in `onDismiss` is the canonical
                // pattern for sheet-after-sheet flows. Drains the
                // pending slot so a repeat create doesn't replay the
                // previous game's invite sheet.
                if let staged = pendingPostCreateInvite {
                    pendingPostCreateInvite = nil
                    postCreateInviteFor = staged
                }
            }) {
                CreateGameView(viewModel: CreateGameViewModel(apiClient: container.apiClient)) { newGame in
                    // Optimistic prepend — show the freshly created game
                    // on home immediately, before the network reload returns.
                    // Without this the user briefly sees a stale list and
                    // wonders if their game was saved. The follow-up
                    // `load()` overwrites with the authoritative server set
                    // (which now also includes their own games regardless
                    // of distance — see backend FAZA 75).
                    viewModel.prependCreated(newGame)
                    Task { await viewModel.load() }
                    // Stage the post-create invite payload so the
                    // `onDismiss` handler above can present the second
                    // sheet AFTER the create sheet's dismiss animation
                    // completes. Setting `postCreateInviteFor` directly
                    // here would race with the same-frame `showCreate
                    // = false` dismissal — SwiftUI consistently drops
                    // the second presentation when both transitions
                    // fire in the same runloop tick. For users with no
                    // signed-in viewer id we fall back to the pre-
                    // invite-sheet behaviour (route to game detail).
                    let viewerId = container.currentUser?.id ?? ""
                    if !viewerId.isEmpty {
                        pendingPostCreateInvite = PostCreateInvitePayload(
                            gameId: newGame.id,
                            hostUserId: viewerId
                        )
                    } else {
                        // Anonymous edge case (signed-in by this point in
                        // practice, but defending). Route to game detail
                        // after the dismiss completes — same `onDismiss`
                        // handler can't push because it would lose the
                        // target, so push here directly. The push will
                        // queue behind the sheet's dismiss animation.
                        let gid = newGame.id
                        pathForCurrentTab().wrappedValue.append(HomeRoute.game(gid))
                    }
                    // Trigger the dismiss now — onDismiss above fires
                    // when SwiftUI finishes the dismissal animation.
                    showCreate = false
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
            }
            .sheet(item: $postCreateInviteFor) { payload in
                PostCreateInviteSheet(
                    viewModel: PostCreateInviteViewModel(
                        apiClient: container.apiClient,
                        userId: payload.hostUserId,
                        gameId: payload.gameId
                    ),
                    onDone: {
                        // After the sheet resolves (either Send-succeeded
                        // or Skip), push the game detail so the host
                        // lands on the screen they expected to land on
                        // before invites were a step. The push happens
                        // BEFORE we clear the sheet binding so the
                        // animation choreography matches the pre-invite
                        // behaviour: dismiss + push in the same frame.
                        let gid = payload.gameId
                        postCreateInviteFor = nil
                        pathForCurrentTab().wrappedValue.append(HomeRoute.game(gid))
                    }
                )
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
            }
            .sheet(isPresented: $showChat, onDismiss: {
                // Reset the sheet's own path so re-opening the sheet
                // lands back on the conversations list, not whichever
                // thread the user was last viewing.
                chatPath = NavigationPath()
            }) {
                NavigationStack(path: $chatPath) {
                    ConversationsView(
                        viewModel: ConversationsViewModel(apiClient: container.apiClient),
                        onOpen: { conv in
                            // Push INSIDE the sheet's own nav stack.
                            // No dismiss/push race because we're not
                            // crossing sheet boundaries.
                            chatPath.append(HomeRoute.thread(conv.id))
                        }
                    )
                    .navigationTitle(Text("messages.nav.title"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button {
                                showChat = false
                            } label: {
                                Image(systemName: "xmark")
                                    .fontWeight(.semibold)
                            }
                            .accessibilityLabel(Text("common.close"))
                        }
                    }
                    .navigationDestination(for: HomeRoute.self, destination: destinationView)
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
            }
            .sheet(isPresented: $showBookCourt) {
                BookCourtView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(.ultraThinMaterial)
            }
            .sheet(isPresented: $showSearch) {
                // SearchView is callback-driven and ships its own
                // NavigationStack for the internal "see all" drilldown.
                // Wrapping it again here would double-nest stacks, so
                // we only add a thin toolbar overlay via a Group +
                // overlay? Actually no — SearchView builds its own
                // NavigationStack internally, so the simplest correct
                // wiring is to present it directly and rely on
                // SearchView's nav chrome. Adding a close button
                // requires injecting a toolbar from outside, which
                // SwiftUI doesn't allow across a nested nav stack.
                // The sheet drag indicator + swipe-down gesture
                // covers the dismiss affordance — same pattern Apple
                // uses for `UISearchController` modal presentations.
                SearchView(
                    viewModel: SearchViewModel(apiClient: container.apiClient),
                    onPickPlayer: { p in
                        showSearch = false
                        homePath.append(HomeRoute.profile(p.id))
                    },
                    onPickGame: { g in
                        showSearch = false
                        homePath.append(HomeRoute.game(g.id))
                    },
                    onPickTournament: { t in
                        showSearch = false
                        pathForCurrentTab().wrappedValue.append(HomeRoute.tournament(t.id))
                    },
                    onPickVenue: { v in
                        showSearch = false
                        homePath.append(HomeRoute.venue(v.id))
                    }
                )
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
            }
            // Stories viewer — full-screen cover driven by the item-binding
            // pattern so opening the viewer from a rail tap clears
            // automatically when the viewer dismisses itself (close X /
            // swipe-down). Re-opens a different group are clean because
            // `presentedStoryGroup` is reset on dismiss.
            .fullScreenCover(item: $presentedStoryGroup) { group in
                StoryViewer(
                    viewModel: StoryViewerViewModel(
                        groups: storiesRail.groups.isEmpty ? [group] : storiesRail.groups,
                        startGroupIndex: storiesRail.groups.firstIndex(where: { $0.id == group.id }) ?? 0,
                        viewerId: container.currentUser?.id,
                        apiClient: container.apiClient,
                        onMarkViewed: { storyId in
                            storiesRail.markFrameViewed(storyId: storyId)
                        },
                        onDelete: { storyId in
                            storiesRail.removeStory(id: storyId)
                        }
                    )
                )
            }
            // Stories creator — separate cover from the viewer; both are
            // mutually exclusive at runtime (the rail's `+` badge always
            // calls `onCreateStory` regardless of whether an existing
            // stack is present).
            .fullScreenCover(isPresented: $showStoryCreator) {
                StoryCreator(
                    viewModel: StoryCreatorViewModel(
                        apiClient: container.apiClient,
                        onPosted: { story in
                            // Optimistically prepend the freshly-posted
                            // story to the rail. The next
                            // pull-to-refresh resolves any drift.
                            if let viewer = container.currentUser {
                                storiesRail.prepend(story: story, viewer: viewer)
                            }
                            showStoryCreator = false
                        }
                    ),
                    onDismiss: { showStoryCreator = false }
                )
            }
            .sheet(isPresented: $showNotifications, onDismiss: {
                // Reset the sheet's own path so re-opening lands back
                // on the inbox tab, matching how the chat sheet resets
                // `chatPath` on dismiss.
                notificationsPath = NavigationPath()
            }) {
                NavigationStack(path: $notificationsPath) {
                    // InboxView hosts the tab picker between
                    // Notifications and Invitations. View-models are
                    // built lazily on first present (memoised on
                    // HomeView) so flipping tabs doesn't lose optimistic
                    // state in the invitations row.
                    InboxView(
                        selection: $inboxTab,
                        notificationsViewModel: inboxNotificationsVM
                            ?? NotificationsViewModel(apiClient: container.apiClient),
                        invitationsViewModel: inboxInvitationsVM
                            ?? InvitationsViewModel(apiClient: container.apiClient),
                        onSelectNotification: { n in
                            // Translate the notification + payload into
                             // a push on the sheet's internal stack so
                            // we don't cross sheet boundaries.
                            if let route = routeForNotification(n) {
                                notificationsPath.append(route)
                            }
                        },
                        invitationsBadge: pendingInvitationsCount
                    )
                        .navigationTitle(Text("inbox.nav.title"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button {
                                    showNotifications = false
                                } label: {
                                    Image(systemName: "xmark")
                                        .fontWeight(.semibold)
                                }
                                .accessibilityLabel(Text("common.close"))
                            }
                        }
                        .navigationDestination(for: HomeRoute.self, destination: destinationView)
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
                .task {
                    // Lazy-init the view-models on first present. Idempotent
                    // — the `??` fallback above ensures we never construct
                    // mid-render; this just materialises them so further
                    // presents reuse the same instances.
                    if inboxNotificationsVM == nil {
                        inboxNotificationsVM = NotificationsViewModel(
                            apiClient: container.apiClient
                        )
                    }
                    if inboxInvitationsVM == nil {
                        inboxInvitationsVM = InvitationsViewModel(
                            apiClient: container.apiClient
                        )
                    }
                }
            }
            // Feed comments thread for the "Friend activity" mini-section.
            // Item-bound so the view-model is built lazily with the tapped
            // event's id (mirrors `postCreateInviteFor`). The viewer
            // identity is threaded so optimistic inserts render the
            // current user's name + avatar before the server echoes back.
            .sheet(item: $commentsEventId) { target in
                FeedCommentsSheet(
                    viewModel: FeedCommentsViewModel(
                        apiClient: container.apiClient,
                        eventId: target.eventId
                    ),
                    currentUserId: container.currentUser?.id,
                    currentDisplayName: container.currentUser?.display_name,
                    currentAvatarURL: container.currentUser?.photo_url
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
            }
        .task {
            await viewModel.onAppear()
            shell = HomeShellViewModel(apiClient: container.apiClient)
            shell.startPolling()
            venues = VenuesViewModel(apiClient: container.apiClient)
            tournaments = TournamentsViewModel(apiClient: container.apiClient)
            // Re-bind per-tab VMs to the real APIClient. These were
            // stub-initialised at @State time (or left nil for `profile`,
            // which needs the AppContainer). Capturing `currentUser?.id`
            // here is correct: the user can't change identity without
            // logging out, which unmounts HomeView.
            matches = MatchesViewModel(
                apiClient: container.apiClient,
                currentUserId: container.currentUser?.id
            )
            // Only bind once we actually have the signed-in id. On a cold
            // launch with a restored session this can still be nil here
            // (AppShell.loadMe hydrates it async); the `.onChange` below
            // binds it the moment it arrives, so we leave the tab empty
            // rather than seeding a broken `userId: ""` VM.
            if let uid = container.currentUser?.id, !uid.isEmpty {
                profile = ProfileViewModel(
                    apiClient: container.apiClient,
                    userId: uid,
                    container: container
                )
            }
            // Stories rail — re-bind to the real APIClient (the stub was
            // wired in at @State init time) and kick off the first fetch.
            // Idempotent: `loadIfNeeded()` returns early on tab re-mount
            // so we don't re-flash a skeleton when the user comes back
            // to the home tab.
            storiesRail = StoriesRailViewModel(apiClient: container.apiClient)
            await storiesRail.loadIfNeeded()
            // Announcements (W10-12) — re-bind to the real APIClient and
            // fire a single load. The banner stays collapsed if no
            // active broadcast resolves; on dismiss the VM re-fetches
            // automatically to surface the next-priority row.
            announcements = AnnouncementsViewModel(apiClient: container.apiClient)
            await announcements.load()
            await loadNearbyPlayers()
            await venues.load()
            await tournaments.load()
            await loadProfileSnapshot()
            // Re-run the version probe on home appear in case the
            // launch-time check from `LinkfitApp.task` was racing the
            // first SwiftUI layout pass. Idempotent: a second probe
            // simply refreshes the cached payload.
            await versionGate.check()
            await loadJoinedGames()
        }
        // Cold-launch hydration race: when the session is restored from the
        // keychain, `AppShell.loadMe()` populates `currentUser` asynchronously,
        // which can land AFTER the `.task` above re-bound the per-user VMs with
        // an empty id (`currentUser?.id ?? ""`). That left the Profile tab
        // fetching `/users//profile` + `/users//streaks` → a not-found screen.
        // Re-bind the Profile / Matches VMs the moment the real signed-in id
        // arrives so they target the user instead of "".
        .onChange(of: container.currentUser?.id) { _, newId in
            guard let newId, !newId.isEmpty else { return }
            if profile?.userId != newId {
                profile = ProfileViewModel(
                    apiClient: container.apiClient,
                    userId: newId,
                    container: container
                )
            }
            matches = MatchesViewModel(
                apiClient: container.apiClient,
                currentUserId: newId
            )
        }
        // Deep-link consume — separate `.task` from the main load chain so
        // a parallel edit to that block doesn't merge-conflict with this
        // wiring (and so failure here can never wedge the data load). Two
        // entry points feed `URLDeepLinkRouter.shared.pendingDestination`:
        //  1. `AppDelegate.userNotificationCenter(_:didReceive:)` — push
        //     tap, while the app is suspended OR foregrounded.
        //  2. `.onOpenURL` in `LinkfitApp.swift` — Universal Link or
        //     `linkfit://` custom-scheme open.
        // Both stash a typed `Destination` and rely on this consume site
        // to push the actual route onto the active tab's NavigationPath.
        //
        // Cold-launch path: the `.task` body below runs once when HomeView
        // first mounts and drains any destination the AppDelegate already
        // stashed before SwiftUI was ready. Warm path: `.onChange` of the
        // observable picks up taps that arrive while the user is already
        // on home. Both call the same `consumePendingDeepLink` helper.
        .task {
            consumePendingDeepLink()
        }
        .onChange(of: URLDeepLinkRouter.shared.pendingDestination) { _, _ in
            consumePendingDeepLink()
        }
        // APNs-tap consumer for routes that don't fit URLDeepLinkRouter's
        // entity-id-shaped scheme. Currently this is the `invitationsInbox`
        // case — `game_invite` taps should open the Inbox sheet on the
        // Invitations tab, which can't be expressed as a single entity id.
        // We tolerate the legacy stream having no consumer historically:
        // listening here is purely additive.
        .task {
            for await link in DeepLinkRouter.shared.links {
                switch link {
                case .invitationsInbox:
                    inboxTab = .invitations
                    showNotifications = true
                case .notificationsInbox:
                    inboxTab = .notifications
                    showNotifications = true
                default:
                    // Other cases route via URLDeepLinkRouter's
                    // pending-destination path; this stream sees them as
                    // a duplicate signal we can safely ignore.
                    break
                }
            }
        }
        .onDisappear { shell.stopPolling() }
    }

    @ViewBuilder
    private var nativeTabs: some View {
        TabView(selection: $activeTab) {
            // Each tab now owns its own NavigationStack — the iOS 26
            // canonical pattern. Tab-scoped navigation paths mean the
            // toolbar/title from `homeContent` is the only one the
            // home tab sees, and a deep push in Matches doesn't
            // collapse Home's chrome.
            NavigationStack(path: $homePath) {
                homeContent
                    .navigationDestination(for: HomeRoute.self, destination: destinationView)
            }
            .tag(AppTab.home)
            .tabItem { tabLabel(.home) }

            NavigationStack(path: $matchesPath) {
                MatchesView(
                    viewModel: matches,
                    onTapGame: { game in matchesPath.append(HomeRoute.game(game.id)) },
                    onTapCreate: { showCreate = true }
                )
                .navigationDestination(for: HomeRoute.self, destination: destinationView)
            }
            .tag(AppTab.matches)
            .tabItem { tabLabel(.matches) }

            NavigationStack(path: $tournamentsPath) {
                TournamentsView(viewModel: tournaments)
                    .navigationDestination(for: HomeRoute.self, destination: destinationView)
            }
            .tag(AppTab.tournaments)
            .tabItem { tabLabel(.tournaments) }

            NavigationStack(path: $profilePath) {
                Group {
                    if let profile {
                        // Re-identify on userId so a re-bind (once the signed-in
                        // id hydrates) rebuilds ProfileView with the new VM
                        // instead of keeping its stale @State copy.
                        ProfileView(viewModel: profile)
                            .id(profile.userId)
                    } else {
                        // First-pass before `.task` hydrates `profile`.
                        // Renders nothing visible; the tab is still
                        // selectable but the body is empty for one
                        // runloop tick until the rebind lands.
                        Color.clear
                    }
                }
                .navigationDestination(for: HomeRoute.self, destination: destinationView)
            }
            .tag(AppTab.profile)
            .tabItem { tabLabel(.profile) }
        }
        .tint(DSColor.accent)
        .glassTabBarMinimize()
        .background(AppGlassBackground())
        .transition(reduceMotion ? .identity : .opacity)
    }

    /// Pending invitations count for the Inbox tab badge. Reads off the
    /// invitations view-model's loaded state; returns 0 while the VM is
    /// still loading or in an error state. The Notifications/Invitations
    /// tab picker observes this to draw a count chip next to the
    /// Invitations tab title.
    private var pendingInvitationsCount: Int {
        guard let vm = inboxInvitationsVM else { return 0 }
        if case .loaded(let items) = vm.state {
            return items.count
        }
        return 0
    }

    /// Drains `URLDeepLinkRouter.shared` and pushes the destination onto
    /// the active tab's NavigationPath. Called both on cold-launch (from
    /// the `.task` modifier) and on warm taps (from `.onChange`).
    ///
    /// Conversation destinations open the chat sheet and push the thread
    /// INSIDE that sheet's own stack (mirrors how `notificationsPath`
    /// works) — that way a push tap on a `message_received` notification
    /// lands the user in the same UI they'd see if they'd opened chat
    /// manually, instead of pushing a one-off thread onto the home tab
    /// where the back arrow would go to home rather than the inbox.
    /// Everything else pushes onto the active tab's path.
    private func consumePendingDeepLink() {
        guard let destination = URLDeepLinkRouter.shared.consume() else { return }
        switch destination {
        case .thread(let id):
            // Open the chat sheet rooted at the inbox, then push the
            // specific thread onto its internal nav stack. Sheets
            // present on the next runloop tick, so we don't fight the
            // animation by appending the path inside the same frame.
            chatPath = NavigationPath()
            chatPath.append(HomeRoute.thread(id))
            showChat = true
        case .game(let id):
            pathForCurrentTab().wrappedValue.append(HomeRoute.game(id))
        case .user(let id):
            pathForCurrentTab().wrappedValue.append(HomeRoute.profile(id))
        case .venue(let id):
            pathForCurrentTab().wrappedValue.append(HomeRoute.venue(id))
        case .referral:
            pathForCurrentTab().wrappedValue.append(HomeRoute.referrals)
        case .tournament(let id):
            pathForCurrentTab().wrappedValue.append(HomeRoute.tournament(id))
        case .squad(let id):
            pathForCurrentTab().wrappedValue.append(HomeRoute.squad(id))
        }
    }

    /// Maps a notification (type + payload) onto a `HomeRoute` for the
    /// notifications sheet's internal stack. Returns `nil` when the
    /// notification carries no actionable target (e.g. a system note
    /// or a kind whose payload field happens to be missing) — or when
    /// the right target is "switch to the Invitations tab" rather than a
    /// push (game_invite, see special-case below).
    private func routeForNotification(_ n: AppNotification) -> HomeRoute? {
        let p = n.payload
        // Game-invite payloads ride on the `tournament_invite` type with
        // `payload.kind == "game_invite"` (matches the backend's reuse
        // strategy in invitations.service.ts). Instead of pushing the
        // game detail (where the invitee can't yet act), flip the inbox
        // tab to Invitations so the user lands on the accept/decline
        // surface. Returning nil suppresses the push.
        if n.type == .tournament_invite, p?.kind == "game_invite" {
            inboxTab = .invitations
            return nil
        }
        // Dedicated `game_invite` notification type (future-proof).
        if n.type == .game_invite, p?.kind == "game_invite" {
            inboxTab = .invitations
            return nil
        }
        switch n.type {
        case .message_received:
            if let cid = p?.conversation_id, UUID(uuidString: cid) != nil { return .thread(cid) }
            return nil
        case .follow:
            // `follower_user_id` is the canonical key (per spec), but
            // tolerate `user_id` so older payloads still route.
            if let uid = p?.follower_user_id, UUID(uuidString: uid) != nil { return .profile(uid) }
            if let uid = p?.user_id, UUID(uuidString: uid) != nil { return .profile(uid) }
            return nil
        case .game_invite, .game_reminder, .no_show_marked,
             .game_joined, .game_cancelled, .rating_received, .tournament_invite:
            if let gid = p?.game_id, UUID(uuidString: gid) != nil { return .game(gid) }
            return nil
        case .system:
            // System notes occasionally carry a profile/venue target —
            // route on whichever id is present, profile first.
            if let uid = p?.follower_user_id, UUID(uuidString: uid) != nil { return .profile(uid) }
            if let uid = p?.user_id, UUID(uuidString: uid) != nil { return .profile(uid) }
            if let vid = p?.venue_id, UUID(uuidString: vid) != nil { return .venue(vid) }
            return nil
        }
    }

    /// Returns the navigation path belonging to whichever tab is
    /// currently active. Used by sheets / cross-tab actions that need
    /// to push into the foreground tab's stack.
    private func pathForCurrentTab() -> Binding<NavigationPath> {
        switch activeTab {
        case .home:        return $homePath
        case .matches:     return $matchesPath
        case .tournaments: return $tournamentsPath
        case .profile:     return $profilePath
        case .chat:        return $homePath // chat tab is a deprecated alias
        }
    }

    /// Active tab swaps to a filled SF Symbol; the rest stay in outline.
    /// That's the Apple-stock pattern: outline = available, fill = active.
    /// We render the label as a Label so the system handles spacing.
    private func tabLabel(_ tab: AppTab) -> some View {
        Label {
            Text(tab.labelKey)
        } icon: {
            Image(systemName: activeTab == tab ? tab.iconFilled : tab.icon)
                .environment(\.symbolVariants, activeTab == tab ? .fill : .none)
        }
    }

    @ViewBuilder
    private func destinationView(for route: HomeRoute) -> some View {
        switch route {
        case .game(let id):
            GameDetailView(viewModel: GameDetailViewModel(
                apiClient: container.apiClient, gameId: id,
                currentUserId: container.currentUser?.id))
        case .profile(let id):
            ProfileView(viewModel: ProfileViewModel(
                apiClient: container.apiClient, userId: id, container: container))
        case .thread(let cid):
            ConversationThreadView(
                viewModel: ConversationThreadViewModel(apiClient: container.apiClient, conversationId: cid, realtime: container.realtime),
                currentUserId: container.currentUser?.id)
        case .groupThread(let cid):
            GroupConversationView(
                viewModel: GroupConversationViewModel(apiClient: container.apiClient, conversationId: cid, realtime: container.realtime),
                currentUserId: container.currentUser?.id,
                onOpenProfile: { uid in
                    homePath.append(HomeRoute.profile(uid))
                }
            )
        case .venue(let id):
            VenueDetailView(viewModel: VenueDetailViewModel(
                apiClient: container.apiClient,
                venueId: id,
                currentUserId: container.currentUser?.id
            ))
        case .venues:
            VenuesView(
                viewModel: VenuesViewModel(apiClient: container.apiClient),
                onOpenVenue: { venue in homePath.append(HomeRoute.venue(venue.id)) }
            )
        case .players:
            // PlayersView was orphaned in the original navigation
            // graph — defined but reachable from nowhere. Wiring it
            // here gives Linkfit its "find people to follow" surface.
            PlayersView(
                viewModel: PlayersViewModel(apiClient: container.apiClient),
                onPickPlayer: { player in homePath.append(HomeRoute.profile(player.id)) }
            )
        case .feed:
            // Full vertical activity feed. The "Friend activity"
            // mini-section on home renders the top 3 events; tapping
            // "See all" pushes here. We translate `FeedCardTarget`
            // back into `HomeRoute` so the feed view stays
            // navigation-agnostic — exact shape recommended by
            // FeedHook.swift. `onFindPlayers` reuses the existing
            // players route so the empty-state CTA leads somewhere
            // useful when the viewer follows nobody yet.
            FeedView(
                viewModel: FeedViewModel(apiClient: container.apiClient),
                onTapTarget: { target in
                    switch target {
                    case .game(let id):       homePath.append(HomeRoute.game(id))
                    case .tournament(let id): homePath.append(HomeRoute.tournament(id))
                    case .profile(let id):    homePath.append(HomeRoute.profile(id))
                    case .none:               break
                    }
                },
                onFindPlayers: { homePath.append(HomeRoute.players) },
                onTapComments: { event in commentsEventId = FeedCommentsTarget(eventId: event.id) }
            )
        case .tournament(let id):
            TournamentDetailView(viewModel: TournamentDetailViewModel(
                apiClient: container.apiClient,
                tournamentId: id
            ))
        case .squad(let id):
            SquadDetailView(viewModel: SquadDetailViewModel(
                apiClient: container.apiClient,
                squadId: id,
                currentUserId: container.currentUser?.id ?? ""
            ))
        case .referrals:
            InviteFriendsView(viewModel: InviteFriendsViewModel(
                apiClient: container.apiClient
            ))
        }
    }

    // MARK: - Home body (matches the LinkFit reference)

    @ViewBuilder
    private var homeContent: some View {
        ZStack {
            AppGlassBackground()
            ScrollView {
                LazyVStack(spacing: 28, pinnedViews: []) { // Uniform 28pt startup spacing
                    homeGreetingHeader

                    // Stories rail at the very top (Instagram-style).
                    StoriesRail(
                        viewModel: storiesRail,
                        viewer: container.currentUser,
                        onOpenGroup: { group in
                            presentedStoryGroup = group
                        },
                        onCreateStory: {
                            showStoryCreator = true
                        },
                        onOpenOwnStack: { group in
                            presentedStoryGroup = group
                        }
                    )

                    // MARK: - Email verification nudge
                    // Self-hides once verified; the outer guard keeps it
                    // out of the stack entirely so there's no phantom gap.
                    if let user = container.currentUser, user.email_verified_at == nil {
                        EmailVerificationBanner(
                            user: user,
                            apiClient: container.apiClient,
                            onVerified: {
                                Task {
                                    if let me = try? await container.apiClient.send(.me) {
                                        container.updateCurrentUser(me)
                                    }
                                }
                            }
                        )
                    }

                    // MARK: - Announcement banner
                    AnnouncementBanner(viewModel: announcements)

                    // Soft-update banner
                    if versionGate.hasNewerVersion, !didDismissUpdateBanner {
                        VersionSoftUpdateBanner(
                            appStoreURL: versionGate.appStoreURL,
                            onDismiss: { didDismissUpdateBanner = true }
                        )
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    // Next game (or a book-court prompt) — the single anchor.
                    smartHeroCard
                        .homeSectionReveal(enabled: !reduceMotion)

                    // Your level snapshot (rating / games / win rate).
                    homeStatsSnapshot

                    // Courts first. Linkfit is a padel app, not a social feed —
                    // nearby clubs sit right under the hero so booking a court is
                    // the primary path. (Removed the suggested-follows rail and
                    // the friends'-activity feed: no social-media stream on Home.)
                    nearbyClubsSection
                        .homeSectionReveal(enabled: !reduceMotion)

                    // Find players to play with — a utility for the core loop,
                    // not a follow / activity feed.
                    playersSection
                        .homeSectionReveal(enabled: !reduceMotion)

                    // MARK: - Daily Challenges (padel engagement goals)
                    ChallengesHook.makeCard(
                        container: container,
                        onTap: { code in
                            switch code {
                            case .follow_one:
                                homePath.append(HomeRoute.players)
                            case .join_a_game:
                                activeTab = .matches
                            case .post_a_story:
                                showStoryCreator = true
                            case .comment_on_feed:
                                homePath.append(HomeRoute.feed)
                            case .invite_to_game:
                                activeTab = .matches
                            case .react_to_story:
                                if let first = storiesRail.groups.first {
                                    presentedStoryGroup = first
                                }
                            }
                        }
                    )

                    Spacer().frame(height: 32)
                }
                .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                // Soft tactile pull-to-refresh haptic confirmation
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                async let g: Void = viewModel.load()
                async let v: Void = venues.load()
                async let p: Void = loadProfileSnapshot()
                async let pl: Void = loadNearbyPlayers()
                async let s: Void = storiesRail.refresh()
                async let a: Void = announcements.load()
                async let j: Void = loadJoinedGames()
                _ = await (g, v, p, pl, s, a, j)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            // Brand wordmark pinned top-left; the greeting below personalizes.
            ToolbarItem(placement: .topBarLeading) {
                LogoWordmark(size: .custom(28))
                    .frame(width: 124)
                    .accessibilityLabel(Text("brand.linkfit"))
            }
            .hideSharedBackgroundIfAvailable()

            // On iOS 26 these four icons sit inside a single shared Liquid
            // Glass capsule — Apple's default toolbar treatment. We used to
            // hide it for a flat look; the glass is exactly the language we
            // want now, so we let it show (the wordmark above stays bare).
            ToolbarItemGroup(placement: .topBarTrailing) {
                searchToolbarButton
                playersToolbarButton
                chatToolbarButton
                notificationToolbarButton
            }
        }
    }

    // MARK: - Greeting + stats snapshot

    private var greetingKey: LocalizedStringKey {
        // Sentence-case "_friendly" variants — the plain ones are uppercase
        // (banned by FAZA 45).
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12:  return "home.greeting.morning_friendly"
        case 12..<18: return "home.greeting.afternoon_friendly"
        default:      return "home.greeting.evening_friendly"
        }
    }

    private var homeGreetingHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(greetingKey)
                    .font(DSType.bodyMedium)
                    .foregroundStyle(DSColor.textSecondary)
                Text(container.currentUser?.display_name ?? String(localized: "home.greeting.player"))
                    .font(DSType.heroTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, DSSpacing.md)
    }

    @ViewBuilder
    private var homeStatsSnapshot: some View {
        if primaryElo != nil || gamesPlayed > 0 {
            HStack(spacing: 10) {
                statTile(value: primaryElo.map(String.init) ?? "—", labelKey: "home.stat.rating", color: DSColor.accent)
                statTile(value: "\(gamesPlayed)", labelKey: "home.stat.games", color: DSColor.textPrimary)
                statTile(value: winRateLabel, labelKey: "home.stat.winrate", color: winRateColor)
            }
            .padding(.horizontal, DSSpacing.md)
        }
    }

    private var winRateLabel: String {
        guard gamesPlayed > 0 else { return "—" }
        return "\(Int((Double(gamesWon) / Double(gamesPlayed) * 100).rounded()))%"
    }

    /// Win-rate tile colour. Neutral by default — `DSColor.success`
    /// (green) is a *state* token and shouldn't read as "good" for a
    /// 12% win rate. We only tint it green once the player is winning
    /// more than half their games (a genuinely positive signal);
    /// otherwise the value sits in `textPrimary` like the games tile.
    private var winRateColor: Color {
        guard gamesPlayed > 0 else { return DSColor.textPrimary }
        let pct = Double(gamesWon) / Double(gamesPlayed) * 100
        return pct > 50 ? DSColor.success : DSColor.textPrimary
    }

    private func statTile(value: String, labelKey: LocalizedStringKey, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(DSType.statValue).foregroundStyle(color)
                .lineLimit(1)              // keep the value on one line…
                .minimumScaleFactor(0.6)   // …and shrink instead of clipping at large Dynamic Type
                .rollingNumber(value)      // digits roll when the stat updates
            Text(labelKey).font(DSType.caption2).foregroundStyle(DSColor.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated))
    }

    // MARK: - Premium Smart Hero Card

    @ViewBuilder
    private var smartHeroCard: some View {
        if let game = upcomingGameForHero {
            Button {
                homePath.append(HomeRoute.game(game.id))
            } label: {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text(String(localized: "home.hero.next_match", defaultValue: "Növbəti oyunun"))
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(DSColor.accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(DSColor.accent.opacity(0.12)))
                            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.35), lineWidth: 1))
                        
                        Spacer()
                        
                        HStack(spacing: 4) {
                            Circle().fill(DSColor.accent).frame(width: 6, height: 6)
                            Text(game.status == .full
                                 ? String(localized: "game.status.full")
                                 : String(localized: "game.status.open"))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(DSColor.textSecondary)
                        }
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(game.venue_name ?? "")
                            .font(.system(size: 18, weight: .heavy))
                            .foregroundStyle(DSColor.textPrimary)
                            .lineLimit(1)
                        
                        HStack(spacing: 6) {
                            Image(systemName: "calendar")
                                .font(.system(size: 12))
                                .foregroundStyle(DSColor.textTertiary)
                            Text(formattedGameTime(game.starts_at))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(DSColor.textSecondary)
                        }
                    }
                    
                    HStack {
                        HStack(spacing: -8) {
                            ForEach(0..<min(game.participants_count, 4), id: \.self) { _ in
                                Circle()
                                    .fill(DSColor.accent.opacity(0.2))
                                    .frame(width: 28, height: 28)
                                    .overlay(
                                        Circle().strokeBorder(DSColor.background, lineWidth: 1.5)
                                    )
                            }
                            if game.participants_count > 4 {
                                Text(verbatim: "+\(game.participants_count - 4)")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(DSColor.textSecondary)
                                    .padding(.leading, 12)
                            }
                        }
                        
                        Spacer()
                        
                        HStack(spacing: 4) {
                            Text(String(localized: "home.hero.view_details", defaultValue: "Ətraflı bax"))
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(DSColor.accent)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .heavy))
                                .foregroundStyle(DSColor.accent)
                        }
                    }
                }
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                        .fill(.ultraThinMaterial)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                        .strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1)
                )
            }
            .buttonStyle(BounceButtonStyle())
            .padding(.horizontal, DSSpacing.md)
        } else {
            Button {
                showBookCourt = true
            } label: {
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(String(localized: "home.hero.live_badge", defaultValue: "Linkfit Live"))
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(DSColor.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(DSColor.accent.opacity(0.12)))
                            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.35), lineWidth: 1))
                        
                        Text(String(localized: "home.hero.book_now_title", defaultValue: "Kort bron et"))
                            .font(.system(size: 18, weight: .heavy))
                            .foregroundStyle(DSColor.textPrimary)
                        
                        Text(String(localized: "home.hero.book_now_subtitle", defaultValue: "İstədiyin vaxt padel oyna"))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    
                    Spacer()
                    
                    ZStack {
                        Circle()
                            .fill(DSColor.accent.opacity(0.12))
                            .frame(width: 50, height: 50)
                        Image(systemName: "figure.tennis")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                    }
                }
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                        .fill(.ultraThinMaterial)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                        .strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1)
                )
            }
            .buttonStyle(BounceButtonStyle())
            .padding(.horizontal, DSSpacing.md)
        }
    }

    private func formattedGameTime(_ iso: String) -> String {
        guard let date = Date.fromISO(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    // MARK: - Toolbar items

    private var searchToolbarButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            showSearch = true
        } label: {
            Image(systemName: "magnifyingglass")
                .fontWeight(.semibold)
        }
        .buttonStyle(BounceButtonStyle())
        .accessibilityLabel(Text("home.action.search"))
    }

    private var playersToolbarButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            homePath.append(HomeRoute.players)
        } label: {
            Image(systemName: "person.2")
                .fontWeight(.semibold)
        }
        .buttonStyle(BounceButtonStyle())
        .accessibilityLabel(Text("home.players"))
    }

    private var chatToolbarButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            showChat = true
        } label: {
            Image(systemName: "bubble.left")
                .fontWeight(.semibold)
                .overlay(alignment: .topTrailing) {
                    if shell.unreadCount > 0 { unreadDot }
                }
        }
        .buttonStyle(BounceButtonStyle())
        .accessibilityLabel(Text("home.chat"))
    }

    private var notificationToolbarButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            showNotifications = true
        } label: {
            Image(systemName: "bell")
                .fontWeight(.semibold)
                .overlay(alignment: .topTrailing) {
                    if shell.unreadCount > 0 { unreadDot }
                }
        }
        .buttonStyle(BounceButtonStyle())
        .accessibilityLabel(Text("home.notifications"))
    }

    private var unreadDot: some View {
        Circle()
            .fill(DSColor.accent)
            .frame(width: 7, height: 7)
            .overlay(Circle().strokeBorder(DSColor.background, lineWidth: 1))
            .offset(x: 3, y: -3)
    }

    // MARK: - Scrollable Carousels & Sections

    @ViewBuilder
    private var upcomingMatchesSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            sectionHeader(titleKey: "home.section.upcoming_matches",
                          onSeeAll: { activeTab = .matches })

            if case .loaded(let games) = viewModel.state, !games.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DSSpacing.md) {
                        ForEach(games.prefix(6)) { game in
                            UpcomingMatchCard(
                                game: game,
                                isJoined: joinedGameIds.contains(game.id),
                                onTapCard: {
                                    homePath.append(HomeRoute.game(game.id))
                                },
                                onJoin: {
                                    joinGameDirectly(game: game)
                                }
                            )
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                }
            } else if case .loading = viewModel.state {
                horizontalSkeletons(width: 320, height: 230)
            } else {
                emptyInlineCard(
                    icon: "calendar.badge.plus",
                    titleKey: "home.empty.matches.title",
                    messageKey: "home.empty.matches.body",
                    ctaKey: "home.empty.matches.cta",
                    ctaIcon: "plus.circle.fill",
                    onCTA: { showCreate = true }
                )
                .padding(.horizontal, DSSpacing.md)
            }
        }
    }

    @ViewBuilder
    private var nearbyClubsSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            sectionHeader(titleKey: "home.section.clubs",
                          onSeeAll: { homePath.append(HomeRoute.venues) })

            if case .loaded(let list) = venues.state, !list.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DSSpacing.md) {
                        ForEach(list) { v in
                            // ClubCard is itself a Button (with its own
                            // SpringPressStyle); a wrapping Button here
                            // double-nested two tappable controls.
                            ClubCard(venue: v) {
                                homePath.append(HomeRoute.venue(v.id))
                            }
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                }
            } else if case .loading = venues.state {
                horizontalSkeletons(width: 200, height: 200)
            } else {
                emptyInlineCard(
                    icon: "building.2",
                    titleKey: "home.empty.clubs.title",
                    messageKey: "home.empty.clubs.body",
                    ctaKey: "home.empty.clubs.cta",
                    ctaIcon: "map",
                    onCTA: { homePath.append(HomeRoute.venues) }
                )
                .padding(.horizontal, DSSpacing.md)
            }
        }
    }

    @ViewBuilder
    private var playersSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            sectionHeader(titleKey: "home.section.players",
                          onSeeAll: { homePath.append(HomeRoute.players) })

            if !nearbyPlayersLoaded {
                horizontalSkeletons(width: 100, height: 140)
            } else if nearbyPlayers.isEmpty {
                emptyInlineCard(
                    icon: "person.2",
                    titleKey: "home.empty.players.title",
                    messageKey: "home.empty.players.body",
                    ctaKey: "home.empty.players.cta",
                    ctaIcon: "magnifyingglass",
                    onCTA: { homePath.append(HomeRoute.players) }
                )
                .padding(.horizontal, DSSpacing.md)
            } else {
                HomePlayersRow(players: nearbyPlayers) { player in
                    homePath.append(HomeRoute.profile(player.id))
                }
            }
        }
    }

    // MARK: - Visual Helpers

    private func sectionHeader(titleKey: LocalizedStringKey,
                               onSeeAll: @escaping () -> Void) -> some View {
        HStack {
            Text(titleKey)
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Spacer()
            Button(action: onSeeAll) {
                HStack(spacing: 3) {
                    Text("common.see_all")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .heavy))
                }
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DSColor.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, DSSpacing.md)
    }

    private func horizontalSkeletons(width: CGFloat, height: CGFloat) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DSSpacing.md) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                                .strokeBorder(DSColor.border.opacity(0.25), lineWidth: 1)
                        )
                        .shimmer()
                        .frame(width: width, height: height)
                }
            }
            .padding(.horizontal, DSSpacing.md)
        }
    }

    private func emptyInlineCard(icon: String,
                                 titleKey: LocalizedStringKey,
                                 messageKey: LocalizedStringKey,
                                 ctaKey: LocalizedStringKey? = nil,
                                 ctaIcon: String? = nil,
                                 onCTA: (() -> Void)? = nil) -> some View {
        VStack(spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 28))
                .foregroundStyle(DSColor.accent) // Royal Blue
            Text(titleKey)
                .font(.system(.subheadline, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
            Text(messageKey)
                .font(DSType.footnote)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
            if let ctaKey, let onCTA {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    onCTA()
                } label: {
                    HStack(spacing: 6) {
                        if let ctaIcon {
                            Image(systemName: ctaIcon)
                                .font(.system(size: 13, weight: .heavy))
                        }
                        Text(ctaKey)
                            .font(.system(size: 13, weight: .heavy))
                    }
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .fill(.ultraThinMaterial) // Matches the glass treatment of every other home card
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    private func loadNearbyPlayers() async {
        do {
            let res = try await container.apiClient.send(
                Endpoint<ItemsResponse<PlayerSummary>>.players(
                    sport: "padel",
                    lat: viewModel.center.latitude,
                    lng: viewModel.center.longitude,
                    radiusKm: 25,
                    limit: 10
                )
            )
            let mine = container.currentUser?.id
            nearbyPlayers = res.items.filter { $0.id != mine }
        } catch {
            nearbyPlayers = []
        }
        nearbyPlayersLoaded = true
    }

    private func loadJoinedGames() async {
        guard container.currentUser != nil else { return }
        let today = Date()
        let calendar = Calendar.current
        let thirtyDaysLater = calendar.date(byAdding: .day, value: 30, to: today) ?? today
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let fromStr = formatter.string(from: today)
        let toStr = formatter.string(from: thirtyDaysLater)
        
        do {
            let res = try await container.apiClient.send(.myAgenda(from: fromStr, to: toStr))
            let joinedIds = res.games.map { $0.id }
            joinedGameIds = Set(joinedIds)
        } catch {
            // best-effort
        }
    }

    private func joinGameDirectly(game: GameSummary) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            do {
                let detail = try await container.apiClient.send(.joinGame(id: game.id))
                // Update the game in HomeViewModel's state!
                viewModel.updateParticipantsCount(id: game.id, count: detail.participants_count)
                
                // Add to joined IDs
                joinedGameIds.insert(game.id)
                
                // Audio + Haptics
                AudioHaptics.shared.play(.gameJoined)
                
                // Show success toast
                ToastCenter.shared.success(String(localized: "game.success.joined", defaultValue: "Oyuna qoşuldunuz!"))
            } catch let error as APIError {
                ToastCenter.shared.error(error.errorDescription ?? String(localized: "game.error.join"))
            } catch {
                ToastCenter.shared.error(error.localizedDescription)
            }
        }
    }

    private func loadProfileSnapshot() async {
        guard let id = container.currentUser?.id else { return }
        do {
            let profile = try await container.apiClient.send(.profile(id: id))
            let padel = profile.stats.first(where: { $0.sport_slug == "padel" })
            primaryElo = padel?.elo_rating
            gamesPlayed = padel?.games_played ?? 0
            gamesWon = padel?.games_won ?? 0
        } catch {
            // best-effort
        }
    }

    private var upcomingGameForHero: GameSummary? {
        guard case .loaded(let games) = viewModel.state else { return nil }
        let now = Date()
        let me = container.currentUser?.id
        let upcoming = games.filter { game in
            guard let d = Date.fromISO(game.starts_at), d > now else { return false }
            return game.status == .open || game.status == .full
        }
        if let mine = upcoming.first(where: { $0.host_user_id == me }) {
            return mine
        }
        return upcoming.first
    }
}

// MARK: - Smart Tactile Button Styles & Custom Shimmers

private struct BounceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

private struct ShimmerEffect: ViewModifier {
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .overlay(
                GeometryReader { proxy in
                    let w = proxy.size.width
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.12), .clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .frame(width: w * 1.5)
                    .offset(x: -w + (phase * w * 2.5))
                }
            )
            .mask(content)
            .onAppear {
                // Decorative loop — skip entirely under Reduce Motion.
                guard !UIAccessibility.isReduceMotionEnabled else { return }
                withAnimation(.linear(duration: 1.8).repeatForever(autoreverses: false)) {
                    phase = 1.0
                }
            }
    }
}

extension View {
    fileprivate func shimmer() -> some View {
        self.modifier(ShimmerEffect())
    }
}

// MARK: - Core Route models & Null API satisfy stubs

/// Identifiable wrapper around a feed event id so it can drive an
/// item-bound `.sheet(item:)` for the comments thread. `String` isn't
/// `Identifiable` on its own; this keeps the present-time view-model
/// construction lazy (one VM per tapped event, not per re-render).
struct FeedCommentsTarget: Identifiable, Hashable {
    let eventId: String
    var id: String { eventId }
}

enum HomeRoute: Hashable {
    case game(String)
    case profile(String)
    case thread(String)
    case groupThread(String)
    case venue(String)
    case venues
    case players
    case feed
    case tournament(String)
    case squad(String)
    case referrals
}

struct HomeNullClient: APIClient {
    func send<R: Decodable>(_ endpoint: Endpoint<R>) async throws -> R {
        throw APIError.unknown(message: "not yet wired")
    }
    func uploadImage(imageData: Data, mimeType: String, filename: String) async throws -> UploadImageResponse {
        throw APIError.unknown(message: "not yet wired")
    }
}

extension ToolbarContent {
    @ToolbarContentBuilder
    func hideSharedBackgroundIfAvailable() -> some ToolbarContent {
        if #available(iOS 26.0, *) {
            self.sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
    }
}

