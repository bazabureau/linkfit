<?php

namespace App\Services\Ratings;

use Illuminate\Support\Facades\DB;

/**
 * Recomputes `player_sport_stats.reliability_score` from a player's history for a
 * single sport. Until this service existed the column was only ever seeded and
 * read (defaulting to 100), so every player showed a frozen reliability of 100:
 * no-shows and bad-behaviour ratings were dead, write-only data. This is now the
 * single place reliability is derived.
 *
 * The score blends two signals, each normalised to [0,1]:
 *   - attendance — how often the player actually showed up to the COMPLETED games
 *     they were a participant in (a no-show flips that game's contribution to 0).
 *   - behaviour  — the share of post-match peer ratings that flagged the player's
 *     behaviour as OK.
 *
 *   reliability = round(100 * (ATTENDANCE_WEIGHT * attendanceRate
 *                              + BEHAVIOUR_WEIGHT * behaviourRate))
 *
 * ⚠️ TUNABLE PRODUCT HEURISTIC — the weights and the formula below are a starting
 * heuristic, NOT a derived constant. With the current 0.7 / 0.3 split a single
 * no-show out of two games lands a player at 65, and a no-show on a game they
 * never attended at 30. Review/adjust before treating the absolute number as
 * authoritative (e.g. wiring it to an achievement threshold).
 */
class ReliabilityService
{
    /** Weight of the attendance (show-up) signal. ATTENDANCE_WEIGHT + BEHAVIOUR_WEIGHT must total 1.0. */
    private const ATTENDANCE_WEIGHT = 0.7;

    /** Weight of the peer-behaviour signal. */
    private const BEHAVIOUR_WEIGHT = 0.3;

    /** player_sport_stats.reliability_score CHECK range (smallint, BETWEEN 0 AND 100). */
    private const SCORE_MIN = 0;

    private const SCORE_MAX = 100;

    /**
     * Derive and persist `reliability_score` for one (user, sport) pair from the
     * player's full history. Idempotent — it recomputes from scratch every call,
     * so running it twice yields the same score. Best-effort by contract: callers
     * wrap it so a recompute failure can never break the match-completion or
     * no-show flow that triggered it.
     *
     * Returns the persisted score, or null when the sport slug is unknown (in
     * which case no row is touched).
     */
    public function recomputeReliability(string $userId, string $sportSlug): ?int
    {
        $sportId = DB::table('sports')->where('slug', $sportSlug)->value('id');
        if ($sportId === null) {
            return null;
        }

        $attendanceRate = $this->attendanceRate($userId, $sportId);
        $behaviourRate = $this->behaviourRate($userId, $sportId);

        $score = (int) round(self::SCORE_MAX * (
            self::ATTENDANCE_WEIGHT * $attendanceRate
            + self::BEHAVIOUR_WEIGHT * $behaviourRate
        ));
        // Clamp to the DB CHECK range so an out-of-band weight tweak can never
        // raise a 23514 check_violation on the UPDATE.
        $score = max(self::SCORE_MIN, min(self::SCORE_MAX, $score));

        // Ensure the stats row exists first: a player who has only ever no-showed
        // has no ELO row yet, but still needs a reliability record.
        DB::table('player_sport_stats')->insertOrIgnore([
            'user_id' => $userId,
            'sport_id' => $sportId,
            'updated_at' => now(),
        ]);
        DB::table('player_sport_stats')
            ->where('user_id', $userId)
            ->where('sport_id', $sportId)
            ->update([
                'reliability_score' => $score,
                'last_recalc_at' => now(),
                'updated_at' => now(),
            ]);

        // Stamp the behaviour ratings we just consumed. `processed_at` was dead
        // (always NULL) before this pipeline existed; marking it keeps these from
        // being mistaken for unprocessed signal by any future incremental pass.
        DB::table('ratings')
            ->where('rated_user_id', $userId)
            ->where('sport_id', $sportId)
            ->whereNull('processed_at')
            ->update(['processed_at' => now()]);

        return $score;
    }

    /**
     * attended / (attended + noShows) over the player's COMPLETED games in this
     * sport, where attended = confirmed participations and noShows = no_show
     * participations. Defaults to 1.0 when the player has no completed games yet
     * (nothing to hold against them).
     */
    private function attendanceRate(string $userId, string $sportId): float
    {
        $counts = DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->where('gp.user_id', $userId)
            ->where('g.sport_id', $sportId)
            ->where('g.status', 'completed')
            ->selectRaw(
                "sum(case when gp.status = 'confirmed' then 1 else 0 end) as attended, "
                ."sum(case when gp.status = 'no_show' then 1 else 0 end) as no_shows"
            )
            ->first();

        $attended = (int) ($counts->attended ?? 0);
        $noShows = (int) ($counts->no_shows ?? 0);
        $total = $attended + $noShows;

        return $total > 0 ? $attended / $total : 1.0;
    }

    /**
     * Share of this player's behaviour ratings (rated_user_id = $userId) for this
     * sport that flagged `behavior_ok`. Defaults to 1.0 when nobody has rated them
     * yet (innocent until rated).
     */
    private function behaviourRate(string $userId, string $sportId): float
    {
        $counts = DB::table('ratings')
            ->where('rated_user_id', $userId)
            ->where('sport_id', $sportId)
            ->selectRaw('count(*) as total, sum(case when behavior_ok then 1 else 0 end) as ok')
            ->first();

        $total = (int) ($counts->total ?? 0);
        $ok = (int) ($counts->ok ?? 0);

        return $total > 0 ? $ok / $total : 1.0;
    }
}
