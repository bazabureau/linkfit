import SwiftUI

/// # Integrating the Share Card feature
///
/// The share card lives **completely independently** of every other
/// feature module. This file documents the two call sites where the host
/// app is expected to surface the sheet — implement them in the relevant
/// feature when ready. No code in this file mutates state outside the
/// `Features/ShareCard/**` namespace.
///
/// ## Call site 1 — after the rating flow finishes
///
/// `RatingFlowView.onFinished` is the natural moment to celebrate a
/// completed match. After ratings are submitted, push the preview sheet:
///
/// ```swift
/// // In whichever VM owns RatingFlowView…
/// .sheet(isPresented: $showShareCard) {
///     ShareCardPreviewSheet(data: shareData(for: game))
/// }
/// ```
///
/// ## Call site 2 — game detail "Share" toolbar button
///
/// `GameDetailView` can offer a permanent share affordance for past
/// games. Wire a toolbar button to flip a `@State var showShareCard`
/// and present `ShareCardPreviewSheet`.
///
/// ## Mapping app models → `ShareCardData`
///
/// `ShareCardData.from(...)` below is a convenience constructor that
/// takes the existing `GameDetail` + `Participant` shapes and produces
/// a card-ready payload. It infers `outcome` from the score and tags the
/// signed-in user via `currentUserId`. The host VM remains responsible
/// for fetching scores, ELO delta, and sharing the resulting `URL`.
///
/// ## What this file does NOT do
///
/// - It does not import other feature modules.
/// - It does not register itself on any router.
/// - It does not mutate `RatingFlowViewModel` or `GameDetailViewModel`.
///
/// Integration is the host feature's responsibility; this file only
/// publishes the public API surface (`ShareCardPreviewSheet`,
/// `ShareCardData`, `ShareCardRenderer`) and a small mapping helper.
enum ShareCardHook {

    /// Builds a `ShareCardData` from the data shapes the rest of the app
    /// already passes around. Pulled out as a static helper so unit tests
    /// can verify the mapping logic without instantiating a view.
    ///
    /// - Parameters:
    ///   - selfTeamScore: Final score of the side the signed-in user is on.
    ///   - opponentScore: Final score of the other side.
    ///   - selfTeamPlayers: Participants who played alongside the user.
    ///   - opponentPlayers: Opponent participants.
    ///   - currentUserId: User who's about to share the card — gets the
    ///     lime "you" highlight on the avatar.
    ///   - sportLabel: Pre-localised sport name, e.g. "Padel".
    ///   - venueName: Optional venue text, joined with a "·" separator.
    ///   - date: When the match was played.
    ///   - eloChange: Computed ELO delta, or `nil` to hide the chip.
    ///   - shareURL: Deep link / web URL for the QR code + footer.
    static func makeData(
        selfTeamScore: Int,
        opponentScore: Int,
        selfTeamPlayers: [(id: String, displayName: String, avatarURL: URL?)],
        opponentPlayers: [(id: String, displayName: String, avatarURL: URL?)],
        currentUserId: String,
        sportLabel: String,
        venueName: String?,
        date: Date,
        eloChange: Int?,
        shareURL: URL?
    ) -> ShareCardData {
        let outcome: MatchOutcome
        if selfTeamScore > opponentScore { outcome = .win }
        else if selfTeamScore < opponentScore { outcome = .loss }
        else { outcome = .draw }

        let venuePart = venueName.flatMap { $0.isEmpty ? nil : $0 }
        let combinedVenue = [sportLabel, venuePart].compactMap { $0 }.joined(separator: " · ")

        return ShareCardData(
            outcome: outcome,
            scoreSelf: selfTeamScore,
            scoreOpponent: opponentScore,
            selfTeam: selfTeamPlayers.map {
                ShareCardPlayer(id: $0.id,
                                displayName: $0.displayName,
                                avatarURL: $0.avatarURL,
                                isSelf: $0.id == currentUserId)
            },
            opponents: opponentPlayers.map {
                ShareCardPlayer(id: $0.id,
                                displayName: $0.displayName,
                                avatarURL: $0.avatarURL,
                                isSelf: false)
            },
            sportAndVenue: combinedVenue,
            date: date,
            eloChange: eloChange,
            shareURL: shareURL
        )
    }

    // MARK: - Wave-10 card builders

    /// Build a `GameJoinedCardData` from the existing `GameDetail` +
    /// signed-in user + (optional) referral code. Wraps the same
    /// participant filtering rules `GameDetailView` uses so the card
    /// renders the same roster the user sees on screen.
    ///
    /// - Parameters:
    ///   - participants: Confirmed participants on the game (already
    ///     filtered to active rows).
    ///   - capacity: Court capacity (`GameDetail.capacity`).
    ///   - hostUserId: User id of the host so we can flag them.
    ///   - currentUserId: User id of the sharer so we can highlight
    ///     their chip.
    ///   - sportLabel: Pre-localised sport name.
    ///   - venueName: Optional venue.
    ///   - startsAt: Game start time.
    ///   - referralCode: Optional referral code for the growth-loop
    ///     URL in the footer.
    ///   - shareURL: Optional deep link / web URL.
    static func makeJoinedData(
        participants: [(id: String, displayName: String, avatarURL: URL?)],
        capacity: Int,
        hostUserId: String,
        currentUserId: String?,
        sportLabel: String,
        venueName: String?,
        startsAt: Date,
        referralCode: String?,
        shareURL: URL?
    ) -> GameJoinedCardData {
        // Sort host first so they always land in slot 0; signed-in
        // user next so the lime chip lands prominently in slot 1
        // (top-right of the 2×2 grid).
        let sorted = participants.sorted { a, b in
            if a.id == hostUserId { return true }
            if b.id == hostUserId { return false }
            if a.id == currentUserId { return true }
            if b.id == currentUserId { return false }
            return false
        }
        let slots = sorted.prefix(max(0, min(4, capacity))).map { p in
            ShareCardPlayer(
                id: p.id,
                displayName: p.displayName,
                avatarURL: p.avatarURL,
                isSelf: p.id == currentUserId,
                isHost: p.id == hostUserId
            )
        }
        return GameJoinedCardData(
            filledSlots: Array(slots),
            capacity: capacity,
            sportLabel: sportLabel,
            venueName: venueName.flatMap { $0.isEmpty ? nil : $0 },
            startsAt: startsAt,
            referralCode: referralCode,
            shareURL: shareURL
        )
    }

    /// Build a `MilestoneCardData` for the signed-in user. Maps from
    /// the ELO integer to a `SkillLevel` via the central helper —
    /// when product later wants to retune thresholds the card moves
    /// in lock-step automatically.
    static func makeMilestoneData(
        currentElo: Int?,
        previousElo: Int?,
        displayName: String,
        gamesPlayed: Int,
        referralCode: String?,
        shareURL: URL?
    ) -> MilestoneCardData {
        let current = SkillLevel.from(elo: currentElo)
        let previous: SkillLevel? = previousElo.map { SkillLevel.from(elo: $0) }
        return MilestoneCardData(
            currentLevel: current,
            previousLevel: previous == current ? nil : previous,
            displayName: displayName,
            gamesPlayed: gamesPlayed,
            referralCode: referralCode,
            shareURL: shareURL
        )
    }
}
