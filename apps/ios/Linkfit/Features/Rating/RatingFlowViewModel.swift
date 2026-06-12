import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#endif

/// Behavior tag the rater can attach to a co-player. The raw value is the
/// wire string sent to the backend; the localised label is rendered in the
/// view via `LocalizedStringKey(rawValue)`.
enum RatingTag: String, CaseIterable, Hashable, Identifiable {
    case team_player
    case fair_play
    case skilled
    case communicator
    case late
    case no_show

    var id: String { rawValue }

    /// Localisation key — paired entries live in `Localizable.xcstrings`.
    var labelKey: String { "rating.tag.\(rawValue)" }

    /// SF Symbol used in the chip. Picked to give the row a quick visual
    /// scan instead of an undifferentiated wall of text.
    var icon: String {
        switch self {
        case .team_player:  return "person.2.fill"
        case .fair_play:    return "hand.raised.fill"
        case .skilled:      return "bolt.fill"
        case .communicator: return "bubble.left.and.bubble.right.fill"
        case .late:         return "clock.badge.exclamationmark"
        case .no_show:      return "person.fill.xmark"
        }
    }

    /// `true` for tags that flag negative behavior. Used to derive
    /// `behavior_ok` automatically — if any negative tag is on, behavior
    /// is not OK. Keeps the form short while preserving the existing
    /// server contract.
    var isNegative: Bool {
        switch self {
        case .late, .no_show: return true
        default: return false
        }
    }
}

/// Per-player draft kept in `RatingFlowViewModel.drafts`. Holds everything
/// the form gathers before it's flattened into a `RatingItemBody` on submit.
struct RatingDraft: Equatable {
    var outcome: String?
    var stars: Int = 0
    var tags: Set<RatingTag> = []
}

@Observable
@MainActor
final class RatingFlowViewModel {
    let gameId: String
    let coplayers: [Participant]
    var index: Int = 0
    /// Per-player drafts keyed by `user_id`. Populated as the user moves
    /// through the carousel — only flushed to the server on `submit`.
    var drafts: [String: RatingDraft] = [:]
    var isSubmitting = false
    var error: String?

    private let apiClient: APIClient

    init(apiClient: APIClient, gameId: String, coplayers: [Participant]) {
        self.apiClient = apiClient
        self.gameId = gameId
        self.coplayers = coplayers
    }

    var currentPlayer: Participant? {
        guard index < coplayers.count else { return nil }
        return coplayers[index]
    }
    var progress: Double {
        guard !coplayers.isEmpty else { return 1 }
        return Double(index) / Double(coplayers.count)
    }
    /// A draft is complete when both the outcome and a star rating are
    /// recorded. Tags are optional — they're a finer-grained signal on
    /// top of the required pieces.
    func isDraftComplete(for userId: String) -> Bool {
        guard let d = drafts[userId] else { return false }
        return d.outcome != nil && d.stars > 0
    }

    /// True when every co-player has a complete draft. The submit button
    /// only enables once this flips.
    var isComplete: Bool {
        guard !coplayers.isEmpty else { return false }
        return coplayers.allSatisfy { isDraftComplete(for: $0.user_id) }
    }

    func draft(for userId: String) -> RatingDraft {
        drafts[userId] ?? RatingDraft()
    }

    func setOutcome(_ outcome: String) {
        guard let p = currentPlayer else { return }
        var d = draft(for: p.user_id)
        d.outcome = outcome
        drafts[p.user_id] = d
        haptic()
    }

    func setStars(_ value: Int) {
        guard let p = currentPlayer else { return }
        var d = draft(for: p.user_id)
        // Tapping the same star count toggles it off so the user can
        // correct a misclick without having to scrub left.
        d.stars = (d.stars == value) ? 0 : value
        drafts[p.user_id] = d
        haptic()
    }

    func toggleTag(_ tag: RatingTag) {
        guard let p = currentPlayer else { return }
        var d = draft(for: p.user_id)
        if d.tags.contains(tag) {
            d.tags.remove(tag)
        } else {
            d.tags.insert(tag)
        }
        drafts[p.user_id] = d
        haptic()
    }

    /// Advance to the next player. The view calls this from a "Next"
    /// button so the carousel is explicit — auto-advance felt jumpy when
    /// the user wanted to also add stars / tags.
    func goNext() {
        guard index < coplayers.count - 1 else { return }
        index += 1
        haptic()
    }

    func goBack() {
        guard index > 0 else { return }
        index -= 1
        haptic()
    }

    func submit() async -> Bool {
        error = nil
        isSubmitting = true
        defer { isSubmitting = false }
        let payload: [RatingItemBody] = coplayers.compactMap { p in
            guard let d = drafts[p.user_id], let outcome = d.outcome else { return nil }
            let behaviorOk = !d.tags.contains(where: { $0.isNegative })
            return RatingItemBody(
                rated_user_id: p.user_id,
                outcome: outcome,
                behavior_ok: behaviorOk,
                stars: d.stars > 0 ? d.stars : nil,
                tags: d.tags.isEmpty ? nil : d.tags.map(\.rawValue).sorted()
            )
        }
        do {
            _ = try await apiClient.send(.submitRatings(gameId: gameId, ratings: payload))
            return true
        } catch let e as APIError {
            error = e.localizedMessage
            return false
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    private func haptic() {
        #if canImport(UIKit)
        Haptics.soft()
        #endif
    }
}
