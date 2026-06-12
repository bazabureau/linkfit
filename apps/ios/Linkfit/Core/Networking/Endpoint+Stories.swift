import Foundation

// MARK: - Stories
//
// Instagram-style stories. The rail on top of HomeView shows a horizontal
// list of "story groups" (one per user who has posted in the last 24h);
// tapping a group opens StoryViewer which steps through the user's stack
// then jumps to the next group. The user's own story is always presented
// as the first item with a "+ create" affordance.
//
// Kept in its own file rather than folded into the central
// `Endpoint.swift` so the Stories feature can evolve without churn on the
// big shared endpoint module — same convention `Endpoint+Privacy.swift`,
// `Endpoint+Referrals.swift`, and `Endpoint+SuggestedFollows.swift`
// already follow.

/// Wave-12 — opaque JSON value used for the `payload` field of an
/// overlay. The server treats `overlays[].payload` as free-form JSONB,
/// so on the wire we model it as a recursive `JSONValue` enum that can
/// round-trip any of the seven JSON value kinds without losing
/// information.
///
/// This stays local to the stories file rather than living in a shared
/// helper because no other endpoint in the app currently needs an
/// opaque JSON value type — keeping the surface area narrow until a
/// second caller arrives.
indirect enum StoryOverlayJSON: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([StoryOverlayJSON])
    case object([String: StoryOverlayJSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([StoryOverlayJSON].self) { self = .array(a); return }
        if let o = try? c.decode([String: StoryOverlayJSON].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(
            in: c,
            debugDescription: "Unsupported JSON value in story overlay payload")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b):   try c.encode(b)
        case .null:          try c.encodeNil()
        case .array(let a):  try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

/// Wave-12 overlay primitive — text label or sticker the composer
/// painted onto the frame. `payload` is opaque on the wire: the iOS
/// renderer decodes it into a richer struct based on `kind`. Keeping
/// `payload` as a `StoryOverlayJSON` here means a new overlay kind
/// ("poll", "music") lands on the server without an immediate iOS
/// recompile — older builds simply ignore unknown kinds when
/// rendering.
///
/// Mentions are NOT modeled here; they ride their own `StoryMention`
/// wire shape because the server normalizes them into a separate
/// table (`story_mentions`) so push fan-out and the reverse-lookup
/// feed don't have to scan JSONB.
/// Renamed from `StoryOverlay` to `StoryOverlayWire` in W12-verify to
/// disambiguate from the editor-side `StoryOverlay` enum
/// (`Features/Stories/StoryOverlay.swift`). The two types serve different
/// purposes: this one is the opaque-payload wire model the server stores;
/// the editor enum is the heterogeneous canvas list with text/mention/
/// sticker variants. They are converted at the upload boundary (a future
/// Wave-13 concern).
struct StoryOverlayWire: Codable, Equatable {
    let kind: String  // "text" | "sticker"
    let payload: StoryOverlayJSON
}

/// Wave-12 mention chip — a tappable label anchored at a normalized
/// `(x, y)` position on the story frame. `display_name` is hydrated
/// server-side from the `users` table on the read path so the chip
/// can render without a second fetch.
struct StoryMention: Codable, Equatable, Identifiable {
    let user_id: String
    let display_name: String
    let x: Double
    let y: Double

    /// `Identifiable` requirement. One mention per user per story
    /// (server-side composite PK), so `user_id` is a stable key.
    var id: String { user_id }
}

/// A single story belonging to a `StoryGroup`. Media is currently always
/// an image; the `media_type` field is carried through to the client so
/// future video support is a wire-only change. `viewed_by_me` reflects
/// the most recent `POST /api/v1/stories/:id/view` outcome (idempotent
/// server-side) — the client may flip it optimistically when the viewer
/// scrolls onto a frame and the markViewed call is in flight.
///
/// `reactions` is a wire-keyed dictionary (`"heart" → 12`) shipped with
/// every feed payload; missing on older responses → treated as empty by
/// the custom `init(from:)` so we degrade gracefully. `my_reaction`
/// carries the viewer's current selection (one of the five wire keys,
/// or `nil` if they haven't reacted). Both fields drive
/// `StoryReactionsBar` and are mutated optimistically by the viewer
/// view-model on tap.
///
/// Wave-12 adds `overlays` (text + sticker entries the composer painted
/// onto the frame) and `mentions` (tappable user chips anchored at
/// normalized `(x, y)` positions). Both default to empty arrays in the
/// custom decoder so pre-Wave-12 server responses keep working — the
/// client tolerates an older API.
///
/// `Equatable` so view-model diffs work in unit tests and SwiftUI can
/// cheaply detect identity changes when the feed reloads. `Identifiable`
/// so `ForEach(stack)` doesn't need an explicit keyPath at the call site.
struct Story: Decodable, Identifiable, Equatable {
    let id: String
    let media_url: String
    let media_type: String
    let caption: String?
    let created_at: String
    let viewed_by_me: Bool
    /// Wire-keyed reaction tally. Missing keys default to zero on the
    /// UI side; the server only ships keys with a non-zero count, so a
    /// fresh story typically arrives with `[:]`.
    let reactions: [String: Int]
    /// Viewer's current reaction (a wire key — `"heart"`, etc.) or
    /// `nil` if they haven't reacted. The viewer-side `StoryReactionEmoji`
    /// enum maps this to a glyph.
    let my_reaction: String?
    /// Wave-12 — text + sticker overlays the composer painted. Empty
    /// on pre-Wave-12 stories.
    let overlays: [StoryOverlayWire]
    /// Wave-12 — mention chips. Empty when no users were tagged in
    /// the frame.
    let mentions: [StoryMention]

    init(
        id: String,
        media_url: String,
        media_type: String,
        caption: String?,
        created_at: String,
        viewed_by_me: Bool,
        reactions: [String: Int] = [:],
        my_reaction: String? = nil,
        overlays: [StoryOverlayWire] = [],
        mentions: [StoryMention] = []
    ) {
        self.id = id
        self.media_url = media_url
        self.media_type = media_type
        self.caption = caption
        self.created_at = created_at
        self.viewed_by_me = viewed_by_me
        self.reactions = reactions
        self.my_reaction = my_reaction
        self.overlays = overlays
        self.mentions = mentions
    }

    /// Custom decoder so pre-reactions wire payloads (which lacked both
    /// fields entirely) still decode — `reactions` defaults to `[:]`,
    /// `my_reaction` stays `nil`. Same trick for the Wave-12 `overlays`
    /// + `mentions` additions — pre-Wave-12 servers ship neither field
    /// and we degrade to empty arrays on the client. Lets us land the
    /// agent without a server-version handshake.
    private enum CodingKeys: String, CodingKey {
        case id, media_url, media_type, caption, created_at, viewed_by_me
        case reactions, my_reaction
        case overlays, mentions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.media_url = try c.decode(String.self, forKey: .media_url)
        self.media_type = try c.decode(String.self, forKey: .media_type)
        self.caption = try c.decodeIfPresent(String.self, forKey: .caption)
        self.created_at = try c.decode(String.self, forKey: .created_at)
        self.viewed_by_me = try c.decode(Bool.self, forKey: .viewed_by_me)
        self.reactions = (try? c.decodeIfPresent([String: Int].self, forKey: .reactions)) ?? [:]
        self.my_reaction = try? c.decodeIfPresent(String.self, forKey: .my_reaction)
        self.overlays = (try? c.decodeIfPresent([StoryOverlayWire].self, forKey: .overlays)) ?? []
        self.mentions = (try? c.decodeIfPresent([StoryMention].self, forKey: .mentions)) ?? []
    }
}

/// One row in the stories rail — a user plus their <= 24h stack of
/// stories sorted oldest-first. `has_unviewed` is the rail's ring-color
/// signal (lime gradient on true, gray on false); `latest_story_at`
/// drives the rail sort order on the server side. The first story in
/// `stories` whose `viewed_by_me == false` is where the viewer should
/// open when this group is tapped.
struct StoryGroup: Decodable, Identifiable, Equatable {
    let user_id: String
    let display_name: String
    let photo_url: String?
    let has_unviewed: Bool
    let latest_story_at: String
    let stories: [Story]

    /// `Identifiable` requirement. Server guarantees one row per user,
    /// so `user_id` is a stable key for SwiftUI ForEach diffing.
    var id: String { user_id }
}

/// Top-level wire envelope for `GET /api/v1/stories/feed`. The server
/// may add metadata (cursors, next-poll hint, etc.) alongside `items`
/// in the future — keeping this struct narrow lets those land as a
/// non-breaking additive change.
struct StoriesFeedResponse: Decodable, Equatable {
    let items: [StoryGroup]
}

/// Wave-12 — mention input for `POST /api/v1/stories`. The server
/// normalizes these into `story_mentions` after filtering against
/// `user_blocks` (bidirectional). `x`/`y` are normalized [0..1] frame
/// coordinates the composer captured when the user dropped the chip.
/// The mention is silently dropped (no error) when:
///   - the target user has blocked the author, or vice versa
///   - the target user is soft-deleted
///   - the target user_id is the author themselves
/// The response's `mentions` field carries the surviving subset so the
/// composer can show a "X couldn't be tagged" toast when shorter.
struct StoryMentionInput: Encodable, Equatable {
    let user_id: String
    let x: Double
    let y: Double
}

/// Body for `POST /api/v1/stories`. The client first uploads the
/// underlying media via the shared `/api/v1/messages/upload-image`
/// multipart endpoint (see `APIClient.uploadImage`), then submits this
/// payload referencing the returned URL. `caption` is optional; empty
/// strings are sent as `null` to keep the server's column null-able and
/// avoid an empty-vs-missing distinction.
///
/// Wave-12 additions:
///   - `overlays` — list of `{kind: "text" | "sticker", payload: …}`
///     entries the composer painted onto the frame. The server treats
///     `payload` as opaque JSONB; the iOS renderer decodes the
///     contents based on `kind`. Omitted (nil) when the composer
///     didn't add any non-mention overlays.
///   - `mentions` — list of `{user_id, x, y}` mention chip anchors.
///     Server-side filtering (block list + soft delete) may drop
///     entries; the response's `mentions` field is the truth.
///
/// Both fields are optional on the wire so an older iOS build still
/// emits a valid create body — the server defaults missing values to
/// empty arrays.
struct CreateStoryRequest: Encodable {
    let media_url: String
    let media_type: String
    let caption: String?
    let overlays: [StoryOverlayWire]?
    let mentions: [StoryMentionInput]?

    /// Convenience initializer so existing call sites (which only pass
    /// `media_url`, `media_type`, and optionally `caption`) keep
    /// compiling without an `overlays: nil, mentions: nil` tail.
    init(
        media_url: String,
        media_type: String,
        caption: String? = nil,
        overlays: [StoryOverlayWire]? = nil,
        mentions: [StoryMentionInput]? = nil
    ) {
        self.media_url = media_url
        self.media_type = media_type
        self.caption = caption
        self.overlays = overlays
        self.mentions = mentions
    }
}

// MARK: - Endpoint constructors
//
// Each endpoint produces a distinct response type, so we use the
// `extension Endpoint where Response == …` pattern — same convention
// `Endpoint+Privacy.swift` and `Endpoint+SuggestedFollows.swift` follow.

extension Endpoint where Response == StoriesFeedResponse {
    /// `GET /api/v1/stories/feed` — fetches the full rail.
    /// Returns `items: []` when the viewer follows nobody with active
    /// stories; the rail hides itself silently in that case (see
    /// `StoriesRail` — no empty-state band).
    static func storiesFeed() -> Endpoint<StoriesFeedResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/stories/feed",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == Story {
    /// `POST /api/v1/stories` — finalises a story after the media is
    /// uploaded. Returns the persisted `Story` so the creator can
    /// optimistically prepend it to the viewer's own group on success.
    static func createStory(_ body: CreateStoryRequest) -> Endpoint<Story> {
        Endpoint(method: .post,
                 path: "/api/v1/stories",
                 body: try? JSONEncoder().encode(body),
                 requiresAuth: true)
    }
}

// MARK: - Wave-13 story viewers list
//
// Author-only "who viewed your story" listing. The backend joins
// `story_views` onto `users` and surfaces it as a flat array sorted
// newest-view-first; the count is shipped alongside so the eye-pill
// in the viewer footer can render without re-counting client-side.
//
// `reaction_emoji` is the wire key (`"heart"`, `"fire"`, …) when the
// viewer also reacted on this story, otherwise `nil`. We treat the
// field as `decodeIfPresent` so a pre-Wave-13 backend that hasn't
// added the join yet still decodes — UI degrades gracefully (no
// reaction chip next to the row).

/// One row in the "who viewed your story" sheet. The wire payload
/// joins `story_views` to `users` so we get a display_name and
/// avatar_url without a follow-up fetch.
///
/// `Identifiable` via `user_id` — one view per (story, user) pair on
/// the server, so the user id is a stable key for SwiftUI `ForEach`
/// diffing.
struct StoryViewerInfo: Decodable, Equatable, Identifiable {
    let user_id: String
    let display_name: String
    let avatar_url: String?
    let viewed_at: String
    /// Wire key of the viewer's reaction on this story (`"heart"`,
    /// `"fire"`, etc.) or `nil` if they didn't react. Decoded with
    /// `decodeIfPresent` so older backends that haven't joined the
    /// reactions table still produce valid rows.
    let reaction_emoji: String?

    var id: String { user_id }

    private enum CodingKeys: String, CodingKey {
        case user_id, display_name, avatar_url, viewed_at, reaction_emoji
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.user_id = try c.decode(String.self, forKey: .user_id)
        self.display_name = try c.decode(String.self, forKey: .display_name)
        self.avatar_url = try c.decodeIfPresent(String.self, forKey: .avatar_url)
        self.viewed_at = try c.decode(String.self, forKey: .viewed_at)
        self.reaction_emoji = try? c.decodeIfPresent(String.self, forKey: .reaction_emoji)
    }

    init(
        user_id: String,
        display_name: String,
        avatar_url: String?,
        viewed_at: String,
        reaction_emoji: String? = nil
    ) {
        self.user_id = user_id
        self.display_name = display_name
        self.avatar_url = avatar_url
        self.viewed_at = viewed_at
        self.reaction_emoji = reaction_emoji
    }
}

/// Top-level envelope for `GET /api/v1/stories/:id/viewers`. Server
/// returns the full set sorted newest-first; pagination is a future
/// concern (a single story rarely has > 200 viewers in 24h). `count`
/// is shipped so the owner's eye-icon pill can render the total
/// without `viewers.count` (no behavioral difference today, but lets
/// the server cap the array later without breaking the pill copy).
struct StoryViewersResponse: Decodable, Equatable {
    let viewers: [StoryViewerInfo]
    let count: Int
}

extension Endpoint where Response == StoryViewersResponse {
    /// `GET /api/v1/stories/:id/viewers` — author-only. Returns 403
    /// when the caller doesn't own the story; the client hides the
    /// eye pill on non-owner stories so the user shouldn't see the
    /// 403 in practice. Sorted newest-first server-side.
    static func storyViewers(id: String) -> Endpoint<StoryViewersResponse> {
        Endpoint(method: .get,
                 path: "/api/v1/stories/\(id)/viewers",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == EmptyResponse {
    /// `POST /api/v1/stories/:id/view` — idempotent. Fired the first
    /// time a story frame becomes the active viewer card; subsequent
    /// calls are server-side no-ops, so the client may also re-fire
    /// safely on reload without bumping any counters.
    static func markStoryViewed(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .post,
                 path: "/api/v1/stories/\(id)/view",
                 requiresAuth: true)
    }

    /// `DELETE /api/v1/stories/:id` — owner-only. Server returns 403
    /// when the caller doesn't own the story; the client treats that
    /// as a hard error (we hide the delete button on non-owner
    /// stories so users shouldn't see the 403 in practice).
    static func deleteStory(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/stories/\(id)",
                 requiresAuth: true)
    }
}

extension Endpoint where Response == StoryReactionResponse {
    /// `POST /api/v1/stories/:id/react` — set (or change) the viewer's
    /// reaction. Server returns the freshly-tallied `reactions` map and
    /// `my_reaction` so the client can adopt the truth without a manual
    /// merge. Server overwrites any prior reaction by the same viewer
    /// (no need for the client to call DELETE first when switching
    /// emojis).
    static func reactToStory(id: String, emoji: StoryReactionEmoji) -> Endpoint<StoryReactionResponse> {
        let body = StoryReactRequest(emoji: emoji.rawValue)
        return Endpoint(method: .post,
                        path: "/api/v1/stories/\(id)/react",
                        body: try? JSONEncoder().encode(body),
                        requiresAuth: true)
    }

    /// `DELETE /api/v1/stories/:id/react` — clear the viewer's
    /// reaction. Idempotent: hitting DELETE when the viewer has no
    /// active reaction simply returns the unchanged tally with
    /// `my_reaction == nil`.
    static func clearStoryReaction(id: String) -> Endpoint<StoryReactionResponse> {
        Endpoint(method: .delete,
                 path: "/api/v1/stories/\(id)/react",
                 requiresAuth: true)
    }
}

// MARK: - Wave-13 reply-to-story

/// Body for `POST /api/v1/stories/:id/reply`. The user-entered text is
/// shipped raw; the server trims + validates (1..500 chars) then
/// persists it as a regular DM in the viewer↔author 1:1 thread with a
/// "↩ Story reply: " sentinel prefix so the recipient's inbox renders
/// it as a quote without a schema migration.
struct StoryReplyRequest: Encodable, Equatable {
    let body: String
}

/// Server response for `POST /api/v1/stories/:id/reply`. Carries the
/// stable ids the iOS client needs to deep-link into the resulting DM
/// thread on success — the same `conversation_id` is reused across
/// repeated replies to stories from the same author (server-side
/// `getOrCreateWith` is idempotent), and `message_id` is the freshly-
/// persisted message row the inbox can scroll-to.
struct StoryReplyResponse: Decodable, Equatable {
    let conversation_id: String
    let message_id: String
}

extension Endpoint where Response == StoryReplyResponse {
    /// `POST /api/v1/stories/:id/reply` — Instagram-style "reply to
    /// story". The server resolves (or creates) a 1:1 DM thread between
    /// the caller and the story author, inserts the body as a message
    /// row, and fans out the existing push + SSE notifications. Errors:
    ///   - 400 when the body is empty after trim OR the viewer is the
    ///         story's author (replying to your own story is a no-op,
    ///         the iOS composer hides itself on owner stories)
    ///   - 404 when the story is expired, never existed, or the viewer
    ///         is bidirectionally blocked from the author (block target
    ///         stays opaque vs. 403)
    static func replyToStory(id: String, body: String) -> Endpoint<StoryReplyResponse> {
        let req = StoryReplyRequest(body: body)
        return Endpoint(method: .post,
                        path: "/api/v1/stories/\(id)/reply",
                        body: try? JSONEncoder().encode(req),
                        requiresAuth: true)
    }
}

// MARK: - Wave-12 overlay wire conversion
//
// The editor holds overlays as a heterogeneous `StoryOverlay` enum
// (`.text(StoryTextOverlay)` / `.mention(StoryMentionOverlay)` /
// `.sticker(StoryStickerOverlay)`). The server splits these into two
// parallel arrays on `CreateStoryBody`:
//
//   - `overlays: [StoryOverlayWire]` — text + sticker entries, payload
//     is opaque JSONB so iOS can evolve the per-kind schema without a
//     server migration.
//   - `mentions: [StoryMentionInput]` — `(user_id, x, y)` triples
//     normalized server-side into `story_mentions` for push fan-out
//     and the reverse-lookup feed.
//
// The conversion lives at the upload boundary (this file) rather than
// inside the editor types so the SwiftUI-facing payloads (`Story-
// TextOverlay`, etc.) stay decoupled from the wire shape. A future
// Wave-13 read path that hydrates `[StoryOverlayWire]` back into
// `StoryOverlay` will land its decode in this same file for symmetry.

extension StoryOverlay {
    /// Wire representation for the `overlays` field on `CreateStory-
    /// Request`. Returns `nil` for the `.mention` case — mentions ride
    /// their own `mentions: [StoryMentionInput]` array (see the create-
    /// payload assembly in `StoryCreatorViewModel.post()`).
    ///
    /// The payload object is intentionally schema-light: every renderer
    /// field stays as a JSON-encoded primitive so an older client
    /// reading a newer story (or vice versa) can ignore unknown keys.
    var wireValue: StoryOverlayWire? {
        switch self {
        case .text(let payload):
            return StoryOverlayWire(
                kind: "text",
                payload: .object([
                    "text": .string(payload.text),
                    "color": .string(payload.color.rawValue),
                    "size": .string(payload.size.rawValue),
                    "alignment": .string(payload.alignment.rawValue),
                    "x": .number(Double(payload.x)),
                    "y": .number(Double(payload.y)),
                    "scale": .number(Double(payload.scale)),
                    "rotation": .number(payload.rotation),
                ])
            )
        case .sticker(let payload):
            return StoryOverlayWire(
                kind: "sticker",
                payload: .object([
                    "emoji": .string(payload.emoji),
                    "x": .number(Double(payload.x)),
                    "y": .number(Double(payload.y)),
                    "scale": .number(Double(payload.scale)),
                    "rotation": .number(payload.rotation),
                ])
            )
        case .drawing(let payload):
            // Wave-13 — finger drawing. `PKDrawing.dataRepresentation()`
            // is a binary blob, and `StoryOverlayJSON` only carries
            // textual primitives, so we base64-encode the bytes into a
            // string field. The server stores the payload as opaque
            // JSONB so it never inspects the contents; older iOS
            // clients reading a newer story ignore unknown overlay
            // kinds and skip the entry gracefully.
            return StoryOverlayWire(
                kind: "drawing",
                payload: .object([
                    "drawing_base64": .string(payload.drawingData.base64EncodedString()),
                    "x": .number(Double(payload.x)),
                    "y": .number(Double(payload.y)),
                    "scale": .number(Double(payload.scale)),
                    "rotation": .number(payload.rotation),
                ])
            )
        case .mention:
            // Mentions go in the parallel `mentions` array — the server
            // normalizes them into `story_mentions` after a block-list
            // filter. Returning nil here is intentional (the caller
            // uses `compactMap` so nils are dropped).
            return nil
        }
    }
}
