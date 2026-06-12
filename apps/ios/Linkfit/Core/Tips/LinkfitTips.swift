import SwiftUI
import TipKit

// MARK: - Tip definitions
//
// Apple's TipKit framework (iOS 17+, deployment target is 18) lets us show
// contextual coach marks ("Tap here to find players nearby!") tied to a
// specific anchor view. Tips honour `displayFrequency` and per-tip rules
// (event counts, parameters) so they don't fight the user — once a tip is
// invalidated (the user taps the content it pointed to, or `invalidate()`
// is called), it never shows again for that install.
//
// Each tip below corresponds to one of the four on-ramps the design team
// flagged as high-impact for new users. Localization is via `Text(key)`,
// which routes through SwiftUI's localizedStringKey machinery and picks
// up the entries we added to `Localizable.xcstrings` — TipKit accepts
// `Text` for title/message specifically so this works out of the box.
//
// Rules use `Tips.Event` rather than time-of-launch checks so we can
// trigger "after N views of X" gates without a separate counter store —
// TipKit persists event counts in its own datastore.

// MARK: 1. Find games near you
//
// Anchor: matches tab icon (HomeView's tab bar).
// Trigger: first launch after signup. We rely on TipKit's default
// "shown once, then invalidated when user interacts with the anchor"
// behaviour — the immediate-frequency policy in `LinkfitTipsRegistry`
// means the very first appearance shows it, and tapping the matches tab
// invalidates it.
struct FindGamesTip: Tip {
    var title: Text { Text("tip.find_games.title") }
    var message: Text? { Text("tip.find_games.body") }
    var image: Image? { Image(systemName: "figure.tennis") }
}

// MARK: 2. Tap a player to see their profile
//
// Anchor: PlayersView's first row.
// Trigger: shown once after 3 visits to PlayersView. The view should
// `donate` `PlayerProfileTip.playersViewVisited` on appear; the rule
// gates the popover until the event has fired three times.
struct PlayerProfileTip: Tip {
    /// Donate this from PlayersView's `.onAppear` (or `.task`):
    /// `await PlayerProfileTip.playersViewVisited.donate()`.
    static let playersViewVisited = Event(id: "players_view_visited")

    var title: Text { Text("tip.player_profile.title") }
    var message: Text? { Text("tip.player_profile.body") }
    var image: Image? { Image(systemName: "person.crop.circle") }

    var rules: [Rule] {
        #Rule(Self.playersViewVisited) { $0.donations.count >= 3 }
    }
}

// MARK: 3. Pull down to refresh
//
// Anchor: the matches list (top of MatchesView's scroll content).
// Trigger: after 5 list views — a deliberately mild nudge for users
// who haven't yet discovered the pull-to-refresh affordance. Donate
// `MatchesPullRefreshTip.listViewed` from MatchesView's `.onAppear`.
struct MatchesPullRefreshTip: Tip {
    static let listViewed = Event(id: "matches_list_viewed")

    var title: Text { Text("tip.pull_refresh.title") }
    var message: Text? { Text("tip.pull_refresh.body") }
    var image: Image? { Image(systemName: "arrow.down.circle") }

    var rules: [Rule] {
        #Rule(Self.listViewed) { $0.donations.count >= 5 }
    }
}

// MARK: 4. Long-press to record voice message
//
// Anchor: the chat composer's mic button in MessagesView.
// Trigger: shown after the first conversation is opened. The
// conversation list / detail entry point should donate
// `VoiceMessageTip.conversationOpened` once when a conversation
// is first viewed.
struct VoiceMessageTip: Tip {
    static let conversationOpened = Event(id: "conversation_opened")

    var title: Text { Text("tip.voice_message.title") }
    var message: Text? { Text("tip.voice_message.body") }
    var image: Image? { Image(systemName: "mic.fill") }

    var rules: [Rule] {
        #Rule(Self.conversationOpened) { $0.donations.count >= 1 }
    }
}

// MARK: - Registry / configuration
//
// One-shot configuration called from `LinkfitApp.init`. `Tips.configure`
// must be called exactly once per process — before any tip is constructed
// — or TipKit logs an assertion and silently no-ops. We swallow errors
// (the API throws if the datastore can't be opened) because a missing
// tip-store should never block app launch; users would lose the entire
// onboarding affordance over a recoverable I/O hiccup.
//
// `.displayFrequency(.immediate)` — show tips as soon as their rules
// evaluate true, no built-in cooldown between distinct tips. We want the
// first-launch tip to land immediately, not the next day.
// `.datastoreLocation(.applicationDefault)` — persist event counts and
// invalidation state in the default container. Sandboxed and per-install,
// so a reinstall correctly resets the tip funnel.
enum LinkfitTipsRegistry {
    static func configure() {
        do {
            try Tips.configure([
                .displayFrequency(.immediate),
                .datastoreLocation(.applicationDefault)
            ])
        } catch {
            // Non-fatal: TipKit failure should never block launch. The
            // worst case is no tips this session.
        }
    }
}

// MARK: - Wiring TODOs
//
// To keep this change parallel-safe (multiple agents are touching the
// feature directories concurrently) the four `.popoverTip(...)` call
// sites are intentionally NOT modified here. The canonical wiring, when
// the feature owners are ready, is:
//
// HomeView.swift  (matches tab item in the TabView):
//     .popoverTip(FindGamesTip())
//
// PlayersView.swift:
//     .task { await PlayerProfileTip.playersViewVisited.donate() }
//     // ...and on the first row's view:
//     .popoverTip(PlayerProfileTip())
//
// MatchesView.swift:
//     .task { await MatchesPullRefreshTip.listViewed.donate() }
//     // ...on the list / scroll-view anchor:
//     .popoverTip(MatchesPullRefreshTip())
//
// MessagesView.swift (conversation-detail composer):
//     // On conversation open:
//     .task { await VoiceMessageTip.conversationOpened.donate() }
//     // On the mic button:
//     .popoverTip(VoiceMessageTip())
//
// All four tips are fully defined and ready to drop in — the only
// remaining work is the single-line `.popoverTip(...)` modifier at each
// anchor and the `.donate()` calls on the gated tips.
