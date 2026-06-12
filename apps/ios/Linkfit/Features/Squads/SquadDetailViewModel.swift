import Foundation
import Observation

/// What the parent list cares about when the user mutates this squad.
/// Three meaningful outcomes that need to propagate up so the list
/// doesn't show a stale row:
///   - `deleted` : owner deleted the squad — drop the row.
///   - `left`    : non-owner left — drop the row.
///   - `updated` : owner edited name / description — update the row.
enum SquadMutation: Equatable {
    case deleted(squadId: String)
    case left(squadId: String)
    case updated(Squad)
}

/// Drives `SquadDetailView`. Owns the squad header + members roster, the
/// "this week" games list for the squad, plus the destructive actions
/// (leave / delete) and the owner edit flow.
///
/// State for the page is the loaded `SquadWithMembers` payload; the games
/// list is a separate observable side-stream so a slow `/games` call
/// doesn't block the header from rendering.
@Observable
@MainActor
final class SquadDetailViewModel {
    /// Squad header + roster. The screen's primary state.
    private(set) var state: ViewState<SquadWithMembers> = .idle
    /// Games where 2+ squad members participate. Independent stream so
    /// the header can render before the games endpoint resolves.
    private(set) var games: [GameSummary] = []
    private(set) var gamesLoaded = false

    /// One-shot error surfaced as an alert in the view. Set when a
    /// mutating action (leave / delete / invite ack flow) fails. Cleared
    /// by the alert's OK button.
    var actionError: String?
    /// True while a destructive action is in flight — disables both the
    /// leave + delete buttons so the user can't double-fire either.
    private(set) var isMutating = false

    let squadId: String
    let currentUserId: String
    let apiClient: APIClient

    init(apiClient: APIClient, squadId: String, currentUserId: String) {
        self.apiClient = apiClient
        self.squadId = squadId
        self.currentUserId = currentUserId
    }

    /// True when the viewer is the squad's captain — drives the
    /// "Düzəliş et" / "Squad-ı sil" affordance set in the view.
    var isOwner: Bool {
        guard case .loaded(let squad) = state else { return false }
        return squad.owner_user_id == currentUserId
    }

    // MARK: - Loading

    func onAppear() async {
        if case .loaded = state { return }
        await load()
    }

    /// Full reload: squad detail + games list, kicked off in parallel.
    /// The header path always wins the `state` race; games settle into
    /// their own stream so the view can render header-only while the
    /// games endpoint is still in flight.
    func load() async {
        guard UUID(uuidString: squadId) != nil else {
            state = .error(message: String(localized: "api.error.not_found"))
            gamesLoaded = true
            return
        }
        async let detail: Void = loadDetail()
        async let gms: Void = loadGames()
        _ = await (detail, gms)
    }

    private func loadDetail() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let detail = try await apiClient.send(Endpoint<SquadWithMembers>.squad(id: squadId))
            state = .loaded(detail)
        } catch let error as APIError {
            state = .error(message: error.localizedMessage)
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    private func loadGames() async {
        do {
            let response = try await apiClient.send(Endpoint<SquadGamesResponse>.squadGames(id: squadId))
            games = response.games
            gamesLoaded = true
        } catch {
            // Games are non-essential to the page — failing silently here
            // is preferable to surfacing a banner that pulls focus away
            // from the squad header. The pull-to-refresh + retry path
            // covers the rare hard failure.
            gamesLoaded = true
            games = []
        }
    }

    // MARK: - Mutations

    /// Owner-only edit flow. Patches name / description and stitches the
    /// updated header back into local state. Returns the new `Squad`
    /// summary so the list parent can refresh its row too.
    @discardableResult
    func updateSquad(name: String?, description: String?) async -> Squad? {
        actionError = nil
        guard isOwner else { return nil }
        let trimmedName = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDesc = description?.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = UpdateSquadBody(
            name: (trimmedName?.isEmpty == false) ? trimmedName : nil,
            description: trimmedDesc,
            photo_url: nil
        )
        isMutating = true
        defer { isMutating = false }
        do {
            let updated = try await apiClient.send(Endpoint<Squad>.updateSquad(id: squadId, body: body))
            // Reconstruct the detail state by merging the new header with
            // the existing roster — saves a second round-trip.
            if case .loaded(let existing) = state {
                state = .loaded(SquadWithMembers(
                    id: updated.id,
                    owner_user_id: updated.owner_user_id,
                    name: updated.name,
                    description: updated.description,
                    photo_url: updated.photo_url,
                    max_size: updated.max_size,
                    created_at: updated.created_at,
                    members: existing.members
                ))
            }
            return updated
        } catch let error as APIError {
            actionError = error.localizedMessage
        } catch {
            actionError = error.localizedDescription
        }
        return nil
    }

    /// Owner-only invite call. Used by the `SquadInviteSheet` — view
    /// owns the toast; the view-model just owns the network call.
    /// Returns true on success so the sheet can dismiss itself.
    @discardableResult
    func invite(userId: String) async -> Bool {
        guard isOwner else {
            actionError = String(localized: "squads.error.owner_only")
            return false
        }
        do {
            _ = try await apiClient.send(
                Endpoint<EmptyResponse>.inviteToSquad(id: squadId, userId: userId)
            )
            return true
        } catch let error as APIError {
            actionError = error.localizedMessage
        } catch {
            actionError = error.localizedDescription
        }
        return false
    }

    /// Non-owner action. Drops the viewer from the roster. Returns the
    /// mutation marker so the view can hand it back up to the list
    /// parent + pop the navigation stack.
    func leave() async -> SquadMutation? {
        actionError = nil
        isMutating = true
        defer { isMutating = false }
        do {
            _ = try await apiClient.send(Endpoint<EmptyResponse>.leaveSquad(id: squadId))
            return .left(squadId: squadId)
        } catch let error as APIError {
            actionError = error.localizedMessage
        } catch {
            actionError = error.localizedDescription
        }
        return nil
    }

    /// Owner-only destructive action. Hard-deletes the squad on the
    /// backend; there's no undo. View confirms via a confirmation dialog
    /// before calling this so an accidental tap doesn't wipe the group.
    func delete() async -> SquadMutation? {
        actionError = nil
        guard isOwner else { return nil }
        isMutating = true
        defer { isMutating = false }
        do {
            _ = try await apiClient.send(Endpoint<EmptyResponse>.deleteSquad(id: squadId))
            return .deleted(squadId: squadId)
        } catch let error as APIError {
            actionError = error.localizedMessage
        } catch {
            actionError = error.localizedDescription
        }
        return nil
    }

    func clearError() {
        actionError = nil
    }
}
