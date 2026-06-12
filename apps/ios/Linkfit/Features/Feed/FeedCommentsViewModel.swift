import Foundation
import Observation

/// Drives `FeedCommentsSheet`. Cursor-paginates
/// `GET /api/v1/feed/:eventId/comments`, posts new comments with
/// optimistic insert + rollback, and deletes owner comments with
/// optimistic remove + rollback. Concurrent loads are de-duped so the
/// per-row pagination trigger doesn't fire multiple requests during fast
/// scroll — same pattern as `FeedViewModel`.
///
/// The model intentionally does not subscribe to the `feed:comment` SSE
/// event yet; that's a follow-on wave (the server fan-out exists, but
/// inbound merging needs careful dedupe against optimistic inserts which
/// hasn't been designed). Today the thread refreshes when the sheet
/// opens; remote comments arrive on the next open.
@Observable
@MainActor
final class FeedCommentsViewModel {
    /// Top-level thread state. `.loaded` carries the rendered comment list;
    /// optimistic inserts live in here too with `pending == true` so the
    /// view can dim them while the POST is in flight.
    private(set) var state: ViewState<[FeedCommentItem]> = .idle

    /// Authoritative total reported by the server on the last successful
    /// page fetch. Surfaced to the host so the feed card can refresh its
    /// "N şərh" label after the sheet closes. Optimistic inserts /
    /// deletes locally bump this so the count never lags the visible list.
    private(set) var total: Int = 0

    /// Pagination spinner — separate from the top-level `.loading` state so
    /// the initial load and the bottom-of-thread pager render differently.
    private(set) var isPaging: Bool = false

    /// Send spinner. The composer's button swaps to a `ProgressView` while
    /// this is true and disables itself; we keep it separate from the
    /// per-comment `pending` flag so the spinner is single-source even when
    /// rapid sends queue up (which they don't, since the button disables).
    private(set) var isSending: Bool = false

    /// Non-nil to surface a transient failure (send rejected by server,
    /// delete rolled back). The view binds an `.alert` to this and clears
    /// on dismiss. We carry a localized string so the alert renders as-is.
    var errorMessage: String?

    /// Draft text bound to the composer. Cleared optimistically on send so
    /// the input empties before the network response — feels instant on
    /// flaky links and matches WhatsApp behaviour.
    var draft: String = ""

    private let apiClient: APIClient
    private let eventId: String
    private let pageSize: Int

    /// `nil` once the timeline is exhausted (no more older pages). Distinct
    /// from "haven't paginated yet" — we use `hasFetchedOnce` for that gate
    /// so the per-row onAppear trigger only fires AFTER the first page lands.
    private var nextCursor: String? = nil
    private var hasFetchedOnce: Bool = false
    private var loaded: [FeedCommentItem] = []
    private var inFlight: Task<Void, Never>?

    init(apiClient: APIClient, eventId: String, pageSize: Int = 20) {
        self.apiClient = apiClient
        self.eventId = eventId
        self.pageSize = pageSize
    }

    // MARK: - Lifecycle

    /// Initial load on sheet appear. Skipped if we already have data so
    /// re-opening the sheet (in the same session) doesn't blank the list.
    func onAppear() async {
        if case .loaded = state { return }
        await refresh()
    }

    /// Pull-to-refresh and initial load. Drops anything we had and starts
    /// from cursor=nil. Pending optimistic inserts are intentionally
    /// preserved across refresh — they're not in the server response yet,
    /// but dropping them would lose the user's typing in flight.
    func refresh() async {
        inFlight?.cancel()
        nextCursor = nil
        hasFetchedOnce = false
        // Keep pending inserts so an in-flight send isn't dropped.
        loaded = loaded.filter(\.pending)
        if case .loaded = state {} else { state = .loading }
        await loadPage(reset: true)
    }

    /// Fetch the next page if there's one left. Triggered by the topmost
    /// row's `onAppear` — comments are oldest-first within a page but the
    /// thread renders newest at the bottom, so we paginate by *appending
    /// older* via the cursor (server orders correctly).
    func loadMore() async {
        guard hasFetchedOnce, nextCursor != nil, !isPaging, inFlight == nil else { return }
        await loadPage(reset: false)
    }

    // MARK: - Mutations

    /// Optimistically appends a pending comment, fires the POST, then
    /// replaces the placeholder with the server row on success. On failure
    /// the placeholder is removed and the draft is restored so the user
    /// can retry without re-typing.
    func send(currentUserId: String?, currentDisplayName: String?, currentAvatarURL: String?) async {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        let originalDraft = draft
        draft = ""
        isSending = true
        defer { isSending = false }

        // Compose the optimistic row. ID is a client-side UUID so the
        // ForEach diff doesn't churn when the server replaces it with the
        // real id — we look up by `localId`, not `id`.
        let localId = UUID().uuidString
        let pending = FeedCommentItem(
            id: localId,
            localId: localId,
            userId: currentUserId ?? "",
            displayName: currentDisplayName ?? "",
            avatarURL: currentAvatarURL,
            body: trimmed,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            pending: true
        )
        loaded.append(pending)
        total += 1
        state = .loaded(loaded)

        do {
            let endpoint: Endpoint<FeedComment> = .createFeedComment(eventId: eventId, body: trimmed)
            let server = try await apiClient.send(endpoint)
            // Replace the pending placeholder in-place so the row's position
            // is stable (no reorder flash). If somehow it's already gone
            // — e.g. a refresh ran concurrently — just append the server
            // row; the dedupe key below is the server `id`.
            if let idx = loaded.firstIndex(where: { $0.localId == localId }) {
                loaded[idx] = FeedCommentItem(serverComment: server)
            } else if !loaded.contains(where: { $0.id == server.id }) {
                loaded.append(FeedCommentItem(serverComment: server))
            }
            state = .loaded(loaded)
        } catch is CancellationError {
            // The sheet was likely dismissed while in flight — leave the
            // pending row alone, next `onAppear` will refresh it. We don't
            // restore the draft on cancel because the user has moved on.
            return
        } catch let error as APIError {
            rollbackPending(localId: localId, restoreDraft: originalDraft)
            errorMessage = error.localizedMessage
        } catch {
            rollbackPending(localId: localId, restoreDraft: originalDraft)
            errorMessage = error.localizedDescription
        }
    }

    /// Optimistically removes the comment, fires DELETE, and rolls back
    /// on failure. The view should only present the delete affordance on
    /// the caller's own comments — but the server is the source of truth
    /// on ownership (returns 403 otherwise), and we surface that via
    /// `errorMessage`.
    func delete(_ comment: FeedCommentItem) async {
        guard case .loaded(var items) = state else { return }
        let snapshot = items
        let snapshotTotal = total
        items.removeAll { $0.id == comment.id }
        loaded = items
        total = max(0, total - 1)
        state = items.isEmpty ? .empty : .loaded(items)

        do {
            _ = try await apiClient.send(Endpoint<EmptyResponse>.deleteFeedComment(commentId: comment.id))
        } catch is CancellationError {
            // Sheet dismissed mid-delete — leave the optimistic removal
            // in place; the row is gone on the server too if the request
            // landed, and the next refresh will repair if not.
            return
        } catch let error as APIError {
            loaded = snapshot
            total = snapshotTotal
            state = .loaded(snapshot)
            errorMessage = error.localizedMessage
        } catch {
            loaded = snapshot
            total = snapshotTotal
            state = .loaded(snapshot)
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Page loading

    private func loadPage(reset: Bool) async {
        if !reset { isPaging = true }
        let cursor = reset ? nil : nextCursor
        let task = Task { [weak self] in
            guard let self else { return }
            await self.performFetch(cursor: cursor, reset: reset)
        }
        inFlight = task
        defer {
            inFlight = nil
            isPaging = false
        }
        await task.value
    }

    private func performFetch(cursor: String?, reset: Bool) async {
        do {
            let endpoint: Endpoint<FeedCommentsPage> = .feedComments(
                eventId: eventId, cursor: cursor, limit: pageSize)
            let page = try await apiClient.send(endpoint)
            if Task.isCancelled { return }
            // Pending optimistic inserts survive a reset (see `refresh()`).
            // Server rows merge in front of them — pending typed comments
            // visually appear at the bottom of the thread until the POST
            // resolves and the placeholder gets replaced.
            let pending = reset ? loaded.filter(\.pending) : []
            if reset { loaded = [] }
            let existing = Set(loaded.map(\.id))
            let pendingIds = Set(pending.map(\.id))
            for c in page.comments where !existing.contains(c.id) && !pendingIds.contains(c.id) {
                loaded.append(FeedCommentItem(serverComment: c))
            }
            if reset {
                // Append surviving pending rows AFTER the server page so
                // unfinished sends still render below the rest of the thread.
                loaded.append(contentsOf: pending)
            }
            nextCursor = page.next_cursor
            total = page.total + pending.count
            hasFetchedOnce = true
            state = loaded.isEmpty ? .empty : .loaded(loaded)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if Task.isCancelled { return }
            if reset { state = .error(message: error.localizedMessage) }
        } catch {
            if Task.isCancelled { return }
            if reset { state = .error(message: error.localizedDescription) }
        }
    }

    private func rollbackPending(localId: String, restoreDraft: String) {
        loaded.removeAll { $0.localId == localId }
        total = max(0, total - 1)
        state = loaded.isEmpty ? .empty : .loaded(loaded)
        // Restore the draft so the user can retry without retyping. Only
        // overwrite if the user hasn't started typing something new in
        // the meantime — otherwise we'd clobber their second attempt.
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft = restoreDraft
        }
    }
}

/// View-side comment row. Distinct from the wire `FeedComment` so it can
/// carry an optimistic-insert flag and a stable `localId` for the
/// placeholder→server-row swap without disturbing the ForEach diff.
///
/// `id` mirrors the server's `id` for real rows and the locally-generated
/// UUID for pending rows. `localId` is always the original placeholder
/// UUID; it stays the same after the server response lands so the row's
/// SwiftUI identity (and therefore its position) doesn't churn.
struct FeedCommentItem: Equatable, Identifiable, Hashable {
    let id: String
    let localId: String
    let userId: String
    let displayName: String
    let avatarURL: String?
    let body: String
    let createdAt: String
    var pending: Bool

    init(id: String,
         localId: String,
         userId: String,
         displayName: String,
         avatarURL: String?,
         body: String,
         createdAt: String,
         pending: Bool) {
        self.id = id
        self.localId = localId
        self.userId = userId
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.body = body
        self.createdAt = createdAt
        self.pending = pending
    }

    /// Build a view item from a server-shaped `FeedComment`. The
    /// `localId` collapses onto the server `id` for non-optimistic rows;
    /// optimistic rows preserve their original UUID via the designated
    /// initializer above.
    init(serverComment c: FeedComment) {
        self.id = c.id
        self.localId = c.id
        self.userId = c.user_id
        self.displayName = c.user_display_name
        self.avatarURL = c.user_avatar_url
        self.body = c.body
        self.createdAt = c.created_at
        self.pending = false
    }
}
