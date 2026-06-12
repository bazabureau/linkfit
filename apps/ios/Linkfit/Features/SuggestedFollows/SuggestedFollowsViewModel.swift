import Foundation
import Observation

/// Backing state for the "People you may know" carousel on PlayersView.
///
/// Lifecycle:
///   * `.task` on the view fires `load()` exactly once per mount —
///     there is no auto-refresh. A pull-to-refresh elsewhere on the
///     page does not re-fetch the suggestion list (cards were chosen
///     deliberately and a fresh shuffle every refresh would feel
///     jittery).
///   * `follow(item:)` is fire-and-forget by design. The card is
///     removed from the local `items` array immediately so the
///     carousel collapses without waiting for the round-trip; we
///     also seed `FollowStore.shared` so a half-open ProfileView
///     for the same user picks up the edge without its own fetch.
///     On failure we re-insert the card at its original index and
///     surface `actionError` for the host to render — same UX as
///     `PlayersViewModel.toggleFollow`.
///
/// Why a discrete view-model instead of folding into `PlayersViewModel`?
///   * The two surfaces have completely different lifecycles — the
///     list reloads on every filter change, the carousel does not.
///   * The carousel ships in its own feature dir behind a hook so
///     other surfaces (Home, Inbox empty-state) can adopt it later
///     without depending on the players list state machine.
@Observable
@MainActor
final class SuggestedFollowsViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded(items: [SuggestedFollowItem])
        case empty
        case error(message: String)
    }

    /// Single source of truth for the UI. The host's switch on
    /// `state` decides whether to render the carousel, hide it
    /// (`empty`), or render a slim skeleton (`loading`).
    private(set) var state: State = .idle

    /// Most-recent transient error from a `follow` action. Surfaced
    /// to the host as an alert binding, identical pattern to
    /// `PlayersViewModel.actionError`.
    private(set) var actionError: String?

    private let apiClient: APIClient

    /// Has `load()` already run? Guards against re-fetching the
    /// carousel on every view re-mount (the host may switch tabs).
    /// We deliberately don't expose a "refresh" — the suggestion
    /// algorithm is server-side and the list is meant to feel stable.
    private var didLoad = false

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Fetch the carousel payload. Idempotent — second and later
    /// calls are no-ops while `didLoad == true`. Call from `.task`.
    func loadIfNeeded() async {
        guard !didLoad else { return }
        await load()
    }

    /// Force-reload — used by the inline retry button on the error
    /// surface. Resets `didLoad` so the loadIfNeeded guard doesn't
    /// short-circuit the next call after a successful recovery.
    func load() async {
        state = .loading
        do {
            let response = try await apiClient.send(Endpoint.suggestedFollows())
            // Cap at 5 client-side as a defensive belt-and-suspenders
            // — the backend already trims, but if a future revision
            // forgets to we don't want the horizontal scroll to
            // sprawl off-screen.
            let trimmed = Array(response.items.prefix(5))
            if trimmed.isEmpty {
                state = .empty
            } else {
                state = .loaded(items: trimmed)
            }
            didLoad = true
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch is CancellationError {
            // View was torn down before the response arrived. Leave
            // state as `.loading` so a remount can re-fire `load()`
            // without us flashing an error.
            return
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Optimistic follow. Drops the card from `items` immediately and
    /// flips the global `FollowStore` so any open ProfileView for the
    /// same user reflects the edge without its own round-trip. On
    /// network failure we re-insert at the original index and surface
    /// the error.
    func follow(item: SuggestedFollowItem) async {
        guard case .loaded(let items) = state else { return }
        guard let idx = items.firstIndex(where: { $0.id == item.id }) else { return }

        // Optimistic: snapshot for revert, then mutate.
        var next = items
        next.remove(at: idx)
        state = next.isEmpty ? .empty : .loaded(items: next)
        FollowStore.shared.setFollowing(userId: item.user_id, isFollowing: true)
        FollowStore.shared.applyCountDelta(forUser: item.user_id, delta: 1)

        do {
            _ = try await apiClient.send(Endpoint.followUser(id: item.user_id))
            // Analytics — `source: .suggested` because this VM backs the
            // "Suggested Follows" rail / list. See AnalyticsEvent.swift
            // for the closed source enum.
            Analytics.track(.followUser(targetUserId: item.user_id, source: .suggested))
        } catch let error as APIError {
            revert(item: item, originalIndex: idx, originalItems: items)
            actionError = error.localizedMessage
        } catch is CancellationError {
            // The view (or app) tore down mid-flight. Don't revert —
            // a re-mount would see the optimistic state and the user
            // would think the follow succeeded. Leave the card hidden;
            // the backend either accepted the request before cancel
            // (most common) or the next session refresh will re-seed.
            return
        } catch {
            revert(item: item, originalIndex: idx, originalItems: items)
            actionError = error.localizedDescription
        }
    }

    /// Clear the most-recent action error after the host presents it.
    func clearActionError() {
        actionError = nil
    }

    // MARK: - Internals

    private func revert(item: SuggestedFollowItem, originalIndex: Int, originalItems: [SuggestedFollowItem]) {
        // Put the card back exactly where it was so the carousel
        // doesn't visually reshuffle on revert. Also undo the
        // FollowStore mutation so the row/profile aren't stuck in
        // an "is following" state that the server never confirmed.
        var restored = originalItems
        if !restored.contains(where: { $0.id == item.id }) {
            let clamped = min(max(originalIndex, 0), restored.count)
            restored.insert(item, at: clamped)
        }
        state = .loaded(items: restored)
        FollowStore.shared.setFollowing(userId: item.user_id, isFollowing: false)
        FollowStore.shared.applyCountDelta(forUser: item.user_id, delta: -1)
    }
}
