import SwiftUI

/// Post-match summary banner shown at the top of `GameDetailView` once a
/// game's status flips to `completed` and the server has a `MatchScore`
/// row to read back. Combines:
///
///   • outcome chip — Won / Lost / Drew (or "Match recorded" for non-
///     participants)
///   • final set tally per team
///   • per-set breakdown (e.g. "6-4 · 4-6 · 7-5")
///   • optional ELO delta chip — supplied separately because the GameDetail
///     payload doesn't carry it; views that have access to a sport-level
///     ELO change can pass it in.
///
/// This view is intentionally stateless — it renders whatever it's handed
/// and lets the caller decide visibility. That keeps it easy to drop into
/// any future "matches I've played" screen, share-card preview, etc.
struct FinalResultCard: View {
    let score: MatchScore
    let participants: [Participant]
    /// Team the viewer is on, if any. Drives the outcome label + tint.
    let myTeam: ScoreTeam?
    /// Optional ELO delta — `nil` hides the chip.
    let eloDelta: Int?

    private var setsWonA: Int {
        score.sets.filter { $0.a > $0.b }.count
    }
    private var setsWonB: Int {
        score.sets.filter { $0.b > $0.a }.count
    }

    /// Result from the viewer's perspective. `nil` for spectators (no team).
    private var outcome: Outcome? {
        guard let mine = myTeam, let winner = score.winning_team else { return nil }
        if winner == mine { return .won }
        return .lost
    }

    private enum Outcome { case won, lost }

    var body: some View {
        Card(padding: DSSpacing.md) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                header
                Divider().overlay(DSColor.border)
                teamRows
                if !score.sets.isEmpty {
                    Divider().overlay(DSColor.border)
                    breakdown
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            // Subtle "completed" stamp in the corner so the banner reads
            // as a final record at a glance — distinct from the live
            // scoreboard.
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(DSColor.accent)
                .padding(DSSpacing.sm)
        }
    }

    // MARK: - Header (outcome banner + ELO chip)

    private var header: some View {
        HStack(spacing: DSSpacing.sm) {
            outcomeBadge
            Spacer()
            if let delta = eloDelta {
                eloChip(delta: delta)
            }
        }
    }

    @ViewBuilder
    private var outcomeBadge: some View {
        switch outcome {
        case .won:
            badge(icon: "trophy.fill",
                  text: String(localized: "game.result.won"),
                  fg: DSColor.textOnAccent,
                  bg: DSColor.accent)
        case .lost:
            badge(icon: "flag.fill",
                  text: String(localized: "game.result.lost"),
                  fg: DSColor.danger,
                  bg: DSColor.danger.opacity(0.12))
        case .none where score.winning_team != nil:
            // Spectator viewing a finished match — say what happened
            // without picking a side.
            badge(icon: "checkmark.seal.fill",
                  text: String(localized: "game.result.recorded"),
                  fg: DSColor.textPrimary,
                  bg: DSColor.surfaceElevated)
        default:
            badge(icon: "equal.circle.fill",
                  text: String(localized: "game.result.draw"),
                  fg: DSColor.info,
                  bg: DSColor.info.opacity(0.12))
        }
    }

    private func badge(icon: String, text: String, fg: Color, bg: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 13, weight: .bold))
            Text(text).font(.system(size: 14, weight: .bold))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .foregroundStyle(fg)
        .background(Capsule().fill(bg))
    }

    private func eloChip(delta: Int) -> some View {
        let positive = delta > 0
        let zero = delta == 0
        let prefix = zero ? "" : (positive ? "+" : "")
        let tint = zero ? DSColor.textSecondary : (positive ? DSColor.success : DSColor.danger)
        return HStack(spacing: 4) {
            Image(systemName: zero
                  ? "minus"
                  : (positive ? "arrow.up.right" : "arrow.down.right"))
                .font(.system(size: 11, weight: .heavy))
            // Numeric delta kept (visceral reward signal) but ELO label
            // dropped in favour of the neutral "xal" / "pts" word — fits
            // the jargon-free vocabulary used elsewhere in the app.
            Text(String(format: String(localized: "score.delta_format"), "\(prefix)\(delta)"))
                .font(.system(size: 12, weight: .bold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(tint.opacity(0.12)))
    }

    // MARK: - Per-team rows

    private var teamRows: some View {
        VStack(spacing: DSSpacing.xs) {
            teamRow(team: .a)
            teamRow(team: .b)
        }
    }

    private func teamRow(team: ScoreTeam) -> some View {
        let setsWon = team == .a ? setsWonA : setsWonB
        let isWinner = score.winning_team == team
        let userIds = team == .a ? score.team_a_user_ids : score.team_b_user_ids
        let names = userIds.compactMap { id in
            participants.first(where: { $0.user_id == id })?.display_name
        }
        let label = names.isEmpty
            ? String(localized: team == .a ? "scoring.team.a" : "scoring.team.b")
            : names.joined(separator: " · ")
        return HStack(spacing: DSSpacing.sm) {
            Image(systemName: isWinner ? "crown.fill" : "person.2")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(isWinner ? DSColor.accent : DSColor.textTertiary)
                .frame(width: 18)
            Text(label)
                .font(isWinner ? DSType.bodyEmphasis : DSType.body)
                .foregroundStyle(isWinner ? DSColor.textPrimary : DSColor.textSecondary)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 4)
            Text("\(setsWon)")
                .font(.system(.title2, design: .default, weight: .heavy))
                .foregroundStyle(isWinner ? DSColor.accent : DSColor.textTertiary)
                .monospacedDigit()
        }
    }

    // MARK: - Breakdown

    private var breakdown: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("game.result.breakdown")
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
            HStack(spacing: 8) {
                ForEach(Array(score.sets.enumerated()), id: \.offset) { idx, s in
                    setPill(index: idx, set: s)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func setPill(index: Int, set: MatchScoreSet) -> some View {
        VStack(spacing: 2) {
            Text("scoring.set.label \(index + 1)")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
            HStack(spacing: 4) {
                Text("\(set.a)")
                    .foregroundStyle(set.a > set.b ? DSColor.accent : DSColor.textSecondary)
                Text("-")
                    .foregroundStyle(DSColor.textTertiary)
                Text("\(set.b)")
                    .foregroundStyle(set.b > set.a ? DSColor.accent : DSColor.textSecondary)
            }
            .font(.system(size: 13, weight: .bold))
            .monospacedDigit()
            if let tb = set.tb {
                Text("(\(tb.a)-\(tb.b))")
                    .font(.system(size: 9))
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(DSColor.surfaceElevated))
    }
}
