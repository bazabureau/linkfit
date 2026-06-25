<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\BlocksPendingGameResults;
use App\Support\ApiException;
use Illuminate\Database\Query\Expression;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MatchController extends ApiController
{
    use BlocksPendingGameResults;

    /**
     * GET /me/pending-results — every finished game the authenticated user still
     * owes a recorded result for (host, or a host-delegated confirmed player).
     * Mirrors the set that the write-guard blocks on, so the app can surface the
     * whole "record your results" to-do list. (P3#84)
     */
    public function pendingResults(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $items = $this->pendingGameResults((string) $user->id);

        return response()->json([
            'items' => $items,
            'count' => count($items),
        ]);
    }

    public function submitRatings(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'ratings' => ['required', 'array', 'min:1', 'max:40'],
            'ratings.*.rated_user_id' => ['required', 'uuid'],
            'ratings.*.outcome' => ['required', 'in:win,loss,draw'],
            'ratings.*.behavior_ok' => ['required', 'boolean'],
        ]);
        $game = DB::table('games')->where('id', $id)->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if (! $this->isConfirmedParticipant($id, (string) $user->id)) {
            throw ApiException::forbidden('Only confirmed participants can submit ratings');
        }
        $participantIds = $this->confirmedParticipantIds($id);

        $recorded = 0;
        $skipped = 0;
        foreach ($data['ratings'] as $rating) {
            if ($rating['rated_user_id'] === $user->id || ! in_array($rating['rated_user_id'], $participantIds, true)) {
                $skipped++;

                continue;
            }
            // Only the rating + behaviour signal is recorded here. games_played /
            // games_won / ELO are written once per game in complete() (see
            // applyMatchOutcome) — incrementing them per-rater inflated stats ~3x.
            $inserted = DB::table('ratings')->insertOrIgnore([
                'game_id' => $id,
                'rater_user_id' => $user->id,
                'rated_user_id' => $rating['rated_user_id'],
                'sport_id' => $game->sport_id,
                'outcome' => $rating['outcome'],
                'behavior_ok' => $rating['behavior_ok'],
                'created_at' => now(),
            ]);
            $recorded += $inserted;
            $skipped += $inserted ? 0 : 1;
        }

        return response()->json(['recorded' => $recorded, 'skipped_duplicates' => $skipped]);
    }

    public function startScoring(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        $this->requireResultWriteAccess($game, $id, (string) $user->id);
        $data = $this->validateBody($request, [
            'team_a_user_ids' => ['required', 'array', 'min:1', 'max:4'],
            'team_b_user_ids' => ['required', 'array', 'min:1', 'max:4'],
        ]);
        $this->assertValidTeams($id, $data['team_a_user_ids'], $data['team_b_user_ids']);
        // A completed match's stats + ELO have already been applied. Resetting it
        // back to in_progress and re-running complete() would double-apply ELO,
        // so refuse to (re)start scoring on an already-completed match.
        $existing = DB::table('match_scores')->where('game_id', $id)->first(['status']);
        if (($existing->status ?? null) === 'completed') {
            throw ApiException::conflict('Match is already completed');
        }
        DB::table('match_scores')->updateOrInsert(
            ['game_id' => $id],
            [
                'team_a_user_ids' => $this->uuidArray($data['team_a_user_ids']),
                'team_b_user_ids' => $this->uuidArray($data['team_b_user_ids']),
                'sets' => json_encode([]),
                'points' => json_encode([]),
                'current_set' => 0,
                'current_game_a' => 0,
                'current_game_b' => 0,
                'point_a' => 0,
                'point_b' => 0,
                'status' => 'in_progress',
                'started_at' => now(),
                'updated_at' => now(),
            ],
        );
        $this->auditWrite($user->id, 'match.scoring_start', 'match_scores', $id, [
            'team_a_user_ids' => array_values($data['team_a_user_ids']),
            'team_b_user_ids' => array_values($data['team_b_user_ids']),
        ]);

        return $this->scoringResponse($id);
    }

    // ── Padel scoring rules (best-of-3). The schema (match-scores.sql) has no
    //    rule columns, so the ruleset lives here. ─────────────────────────────
    private const GAMES_TO_WIN_SET = 6;   // win-by-2, tiebreak at 6-6

    private const SETS_TO_WIN_MATCH = 2;  // best-of-3 (current_set caps at 2)

    private const TIEBREAK_TARGET = 7;    // first to 7, win-by-2

    private const GOLDEN_POINT = true;    // sudden death at 40-40 (padel default)

    public function point(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        $this->requireResultWriteAccess($game, $id, (string) $user->id);
        $data = $this->validateBody($request, ['team' => ['required', 'in:a,b']]);
        // Lock the score row before the read-modify-write of points[] so two
        // concurrent scoring calls (possible via setResultAccess delegation) can't
        // both read the same log and silently lose a point. Re-check status under
        // the lock. complete()/reportResult() already lock; match them.
        $state = DB::transaction(function () use ($id, $data) {
            $row = DB::table('match_scores')->where('game_id', $id)->lockForUpdate()->first();
            if ($row === null) {
                throw ApiException::notFound('Scoring has not started');
            }
            if ($row->status !== 'in_progress') {
                throw ApiException::conflict('Scoring is not in progress');
            }
            $points = json_decode($row->points ?? '[]', true) ?: [];
            $points[] = $data['team'];
            $state = $this->replayState($points);
            DB::table('match_scores')->where('game_id', $id)->update($this->stateColumns($points, $state));

            return $state;
        });
        $this->auditWrite($user->id, 'match.scoring_point', 'match_scores', $id, [
            'team' => $data['team'],
            'match_complete' => $state['winner'] !== null,
        ]);

        return $this->scoringResponse($id);
    }

    public function undo(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        $this->requireResultWriteAccess($game, $id, (string) $user->id);
        // Lock the score row before the read-modify-write of points[] (re-check
        // status under the lock) so concurrent undo/point calls can't lose updates.
        $last = DB::transaction(function () use ($id) {
            $row = DB::table('match_scores')->where('game_id', $id)->lockForUpdate()->first();
            if ($row === null) {
                throw ApiException::notFound('Scoring has not started');
            }
            if ($row->status !== 'in_progress') {
                throw ApiException::conflict('Scoring is not in progress');
            }
            $points = json_decode($row->points ?? '[]', true) ?: [];
            $last = array_pop($points);
            $state = $this->replayState($points);
            DB::table('match_scores')->where('game_id', $id)->update($this->stateColumns($points, $state));

            return $last;
        });
        $this->auditWrite($user->id, 'match.scoring_undo', 'match_scores', $id, [
            'team' => $last,
        ]);

        return $this->scoringResponse($id);
    }

    public function complete(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        $this->requireResultWriteAccess($game, $id, (string) $user->id);
        $row = $this->scoreRow($id);
        if ($row->status !== 'in_progress') {
            throw ApiException::conflict('Scoring is not in progress');
        }
        $points = json_decode($row->points ?? '[]', true) ?: [];
        $state = $this->replayState($points);

        // The match may only be completed once it has an authoritative winner
        // (best-of-N decided). Ending early — zero/partial points with no decided
        // winner — must NOT apply ELO/stats (that would be scored as a draw and
        // corrupt ratings). The points log is the single source of truth.
        if ($state['winner'] === null) {
            throw ApiException::validation('Match is not complete');
        }

        // Commit the in-progress set only if any games were played, so a host
        // ending early still records what actually happened on court.
        $sets = $state['sets'];
        if ($state['current_game_a'] > 0 || $state['current_game_b'] > 0) {
            $sets[] = ['a' => $state['current_game_a'], 'b' => $state['current_game_b']];
        }
        // Use the canonical match winner from replayState (decided by sets won),
        // NOT winnerFromSets($sets) — the latter counts the partial in-progress
        // set appended above and can disagree with the real result, applying ELO
        // to the wrong team.
        $winningTeam = $state['winner'];
        $teamA = $this->pgArray($row->team_a_user_ids);
        $teamB = $this->pgArray($row->team_b_user_ids);

        // Completion is the single authoritative place player stats + ELO are
        // written — once per game, never per rating. Locked + status-rechecked
        // so two concurrent complete() calls can't double-count.
        $deltas = DB::transaction(function () use ($id, $sets, $state, $game, $teamA, $teamB, $winningTeam) {
            $locked = DB::table('match_scores')->where('game_id', $id)->lockForUpdate()->first(['status']);
            if ($locked === null || $locked->status !== 'in_progress') {
                return null; // already completed by a concurrent request
            }
            $deltas = $this->applyMatchOutcome((string) $game->sport_id, $teamA, $teamB, $winningTeam);
            DB::table('match_scores')->where('game_id', $id)->update([
                'status' => 'completed',
                'sets' => json_encode($sets),
                'current_set' => $state['current_set'],
                'current_game_a' => $state['current_game_a'],
                'current_game_b' => $state['current_game_b'],
                'point_a' => min(99, $state['point_a']),
                'point_b' => min(99, $state['point_b']),
                'elo_delta_by_user' => json_encode($deltas),
                'completed_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('games')->where('id', $id)->update(['status' => 'completed', 'updated_at' => now()]);

            return $deltas;
        });

        $this->auditWrite($user->id, 'match.scoring_complete', 'match_scores', $id, [
            'sets' => $sets,
            'winning_team' => $winningTeam,
            'elo_delta_by_user' => $deltas ?? [],
        ]);

        return $this->scoringResponse($id);
    }

    /**
     * Record a finished game's result in ONE call — the practical way players
     * log "who won + the score" after a casual game (vs. the point-by-point
     * scoring flow). Only the host or a host-delegated confirmed participant can
     * submit the two teams and the final set scores; the winner is derived, ELO
     * + win/loss are applied once, and the game is marked completed. Idempotent:
     * a second call after the result is recorded is a no-op that returns the
     * existing score.
     */
    public function reportResult(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        $this->requireResultWriteAccess($game, $id, (string) $user->id);

        $data = $this->validateBody($request, [
            'team_a_user_ids' => ['required', 'array', 'min:1', 'max:4'],
            'team_a_user_ids.*' => ['uuid'],
            'team_b_user_ids' => ['required', 'array', 'min:1', 'max:4'],
            'team_b_user_ids.*' => ['uuid'],
            'sets' => ['required', 'array', 'min:1', 'max:5'],
            'sets.*.a' => ['required', 'integer', 'min:0', 'max:99'],
            'sets.*.b' => ['required', 'integer', 'min:0', 'max:99'],
        ]);
        $this->assertValidTeams($id, $data['team_a_user_ids'], $data['team_b_user_ids']);

        $sets = array_map(fn ($s) => ['a' => (int) $s['a'], 'b' => (int) $s['b']], $data['sets']);
        // Each set must have a winner: scores stay within 0..99 (enforced by the
        // body rules) but a == b is a tie, which is not a valid recorded set.
        // Relaxed from the old per-set shape rules to a single a != b check. (P3#87)
        foreach ($sets as $i => $s) {
            if ($s['a'] === $s['b']) {
                throw ApiException::validation('Set '.($i + 1)." cannot be a tie ({$s['a']}-{$s['b']}); each set must have a winner");
            }
        }
        $winningTeam = $this->winnerFromSets($sets);
        $teamA = array_values($data['team_a_user_ids']);
        $teamB = array_values($data['team_b_user_ids']);
        $lastSet = end($sets) ?: ['a' => 0, 'b' => 0];

        $deltas = DB::transaction(function () use ($id, $sets, $lastSet, $game, $teamA, $teamB, $winningTeam) {
            DB::table('games')->where('id', $id)->lockForUpdate()->first(['id']);
            $locked = DB::table('match_scores')->where('game_id', $id)->lockForUpdate()->first(['status']);
            if ($locked !== null && $locked->status === 'completed') {
                return null; // already recorded — idempotent no-op
            }
            $deltas = $this->applyMatchOutcome((string) $game->sport_id, $teamA, $teamB, $winningTeam);
            DB::table('match_scores')->updateOrInsert(
                ['game_id' => $id],
                [
                    'team_a_user_ids' => $this->uuidArray($teamA),
                    'team_b_user_ids' => $this->uuidArray($teamB),
                    'sets' => json_encode($sets),
                    'points' => json_encode([]),
                    'current_set' => min(2, max(0, count($sets) - 1)),
                    'current_game_a' => min(7, (int) $lastSet['a']),
                    'current_game_b' => min(7, (int) $lastSet['b']),
                    'point_a' => 0,
                    'point_b' => 0,
                    'status' => 'completed',
                    'started_at' => now(),
                    'completed_at' => now(),
                    'elo_delta_by_user' => json_encode($deltas),
                    'updated_at' => now(),
                ],
            );
            DB::table('games')->where('id', $id)->update(['status' => 'completed', 'updated_at' => now()]);

            return $deltas;
        });

        if ($deltas !== null) {
            $this->auditWrite($user->id, 'match.result_reported', 'match_scores', $id, [
                'sets' => $sets,
                'winning_team' => $winningTeam,
                'elo_delta_by_user' => $deltas,
            ]);
        }

        return $this->scoringResponse($id);
    }

    public function setResultAccess(Request $request, string $id, string $uid): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        if ((string) $game->host_user_id !== (string) $user->id) {
            throw ApiException::forbidden('Only the host can manage result access');
        }

        $data = $this->validateBody($request, [
            'can_report_result' => ['required', 'boolean'],
        ]);

        $participant = DB::table('game_participants')
            ->where('game_id', $id)
            ->where('user_id', $uid)
            ->where('status', 'confirmed')
            ->first(['user_id']);
        if ($participant === null) {
            throw ApiException::notFound('Confirmed game participant not found');
        }

        DB::table('game_participants')
            ->where('game_id', $id)
            ->where('user_id', $uid)
            ->update([
                'can_report_result' => (bool) $data['can_report_result'],
            ]);

        $this->auditWrite($user->id, 'match.result_access_set', 'game_participants', $id, [
            'participant_user_id' => $uid,
            'can_report_result' => (bool) $data['can_report_result'],
        ]);

        return response()->json([
            'game_id' => $id,
            'user_id' => $uid,
            'can_report_result' => (bool) $data['can_report_result'],
        ]);
    }

    /**
     * Authoritative post-match write: +1 game played per confirmed player, +1
     * win per member of the winning team, and a team-ELO update (K=32) so the
     * elo_rating curve is real instead of frozen at the 1200 default. Returns
     * the per-user ELO delta map for match_scores.elo_delta_by_user.
     */
    private function applyMatchOutcome(string $sportId, array $teamA, array $teamB, ?string $winningTeam): array
    {
        $all = array_values(array_unique(array_merge($teamA, $teamB)));
        if ($all === []) {
            return [];
        }

        $current = DB::table('player_sport_stats')
            ->where('sport_id', $sportId)
            ->whereIn('user_id', $all)
            ->pluck('elo_rating', 'user_id');
        $eloOf = fn ($uid) => (int) ($current[$uid] ?? 1200);
        $avg = fn (array $team) => $team === [] ? 1200.0 : array_sum(array_map($eloOf, $team)) / count($team);

        $avgA = $avg($teamA);
        $avgB = $avg($teamB);
        $expectedA = 1 / (1 + 10 ** (($avgB - $avgA) / 400));
        $scoreA = $winningTeam === 'a' ? 1.0 : ($winningTeam === 'b' ? 0.0 : 0.5);
        $k = 32;

        $deltas = [];
        foreach ([['a', $teamA, $expectedA, $scoreA], ['b', $teamB, 1 - $expectedA, 1 - $scoreA]] as [$side, $team, $expected, $score]) {
            $delta = (int) round($k * ($score - $expected));
            $won = $winningTeam !== null && $winningTeam === $side;
            foreach ($team as $uid) {
                DB::table('player_sport_stats')->insertOrIgnore([
                    'user_id' => $uid,
                    'sport_id' => $sportId,
                    'updated_at' => now(),
                ]);
                DB::table('player_sport_stats')
                    ->where('user_id', $uid)
                    ->where('sport_id', $sportId)
                    ->update([
                        'games_played' => DB::raw('games_played + 1'),
                        'games_won' => DB::raw($won ? 'games_won + 1' : 'games_won'),
                        'elo_rating' => $this->minEloExpression($delta),
                        'updated_at' => now(),
                    ]);
                $deltas[$uid] = $delta;
            }
        }

        return $deltas;
    }

    /** Map a replayed state to the match_scores column set written by point/undo. */
    private function stateColumns(array $points, array $state): array
    {
        return [
            'points' => json_encode($points),
            'sets' => json_encode($state['sets']),
            'current_set' => $state['current_set'],
            'current_game_a' => $state['current_game_a'],
            'current_game_b' => $state['current_game_b'],
            // Clamp the stored display counters to the DB CHECK (0-99). The
            // canonical game state is the points[] log (replayed uncapped), so a
            // long tiebreak past 99 still resolves correctly — only the cosmetic
            // column is capped, never the win logic.
            'point_a' => min(99, $state['point_a']),
            'point_b' => min(99, $state['point_b']),
            'updated_at' => now(),
        ];
    }

    /**
     * Pure derivation of the full scoring state from the chronological points
     * log — the single source of truth shared by point()/undo()/complete() so
     * they can never diverge. points → games (win-by-2, golden-point toggle) →
     * sets (6, tiebreak at 6-6) → match (first to 2 sets).
     *
     * @return array{sets:array,current_set:int,current_game_a:int,current_game_b:int,point_a:int,point_b:int,winner:?string}
     */
    private function replayState(array $points): array
    {
        $sets = [];
        $setsWonA = 0;
        $setsWonB = 0;
        $gamesA = 0;
        $gamesB = 0;
        $pa = 0;
        $pb = 0;
        $winner = null;

        foreach ($points as $team) {
            if ($winner !== null) {
                break; // match decided; ignore any stray trailing points
            }
            if ($team === 'a') {
                $pa++;
            } else {
                $pb++;
            }

            $isTiebreak = ($gamesA === self::GAMES_TO_WIN_SET && $gamesB === self::GAMES_TO_WIN_SET);
            $gameWinner = $this->gameWinner($pa, $pb, $isTiebreak);
            if ($gameWinner === null) {
                continue;
            }

            if ($gameWinner === 'a') {
                $gamesA++;
            } else {
                $gamesB++;
            }
            $pa = 0;
            $pb = 0;

            $setWinner = $this->setWinner($gamesA, $gamesB);
            if ($setWinner !== null) {
                $sets[] = ['a' => $gamesA, 'b' => $gamesB];
                if ($setWinner === 'a') {
                    $setsWonA++;
                } else {
                    $setsWonB++;
                }
                $gamesA = 0;
                $gamesB = 0;
                if ($setsWonA >= self::SETS_TO_WIN_MATCH) {
                    $winner = 'a';
                } elseif ($setsWonB >= self::SETS_TO_WIN_MATCH) {
                    $winner = 'b';
                }
            }
        }

        return [
            'sets' => $sets,
            'current_set' => min(count($sets), 2),
            'current_game_a' => $gamesA,
            'current_game_b' => $gamesB,
            'point_a' => $pa,
            'point_b' => $pb,
            'winner' => $winner,
        ];
    }

    /** 'a'|'b' if the current game is won, else null. */
    private function gameWinner(int $pa, int $pb, bool $isTiebreak): ?string
    {
        if ($isTiebreak) {
            if ($pa >= self::TIEBREAK_TARGET && $pa - $pb >= 2) {
                return 'a';
            }
            if ($pb >= self::TIEBREAK_TARGET && $pb - $pa >= 2) {
                return 'b';
            }

            return null;
        }
        if (self::GOLDEN_POINT) {
            // Sudden death at 40-40: 4th point wins outright.
            if ($pa >= 4 && $pa > $pb) {
                return 'a';
            }
            if ($pb >= 4 && $pb > $pa) {
                return 'b';
            }

            return null;
        }
        // Deuce/advantage: 4+ points and a 2-point margin.
        if ($pa >= 4 && $pa - $pb >= 2) {
            return 'a';
        }
        if ($pb >= 4 && $pb - $pa >= 2) {
            return 'b';
        }

        return null;
    }

    /** 'a'|'b' if the current set is won, else null. */
    private function setWinner(int $gamesA, int $gamesB): ?string
    {
        $target = self::GAMES_TO_WIN_SET;
        // Tiebreak set: decided 7-6.
        if ($gamesA === $target + 1 && $gamesB === $target) {
            return 'a';
        }
        if ($gamesB === $target + 1 && $gamesA === $target) {
            return 'b';
        }
        // Normal set: 6+ games with a 2-game margin.
        if ($gamesA >= $target && $gamesA - $gamesB >= 2) {
            return 'a';
        }
        if ($gamesB >= $target && $gamesB - $gamesA >= 2) {
            return 'b';
        }

        return null;
    }

    /** Winner by sets won; null on a genuine tie (never a false 'a' default). */
    private function winnerFromSets(array $sets): ?string
    {
        $a = 0;
        $b = 0;
        foreach ($sets as $s) {
            if ((int) ($s['a'] ?? 0) > (int) ($s['b'] ?? 0)) {
                $a++;
            } elseif ((int) ($s['b'] ?? 0) > (int) ($s['a'] ?? 0)) {
                $b++;
            }
        }

        return $a === $b ? null : ($a > $b ? 'a' : 'b');
    }

    public function scoring(Request $request, string $id): JsonResponse
    {
        // Public games keep their open (spectator) scoreboard, but an invite-only
        // game's live score, team rosters and per-user ELO deltas must only be
        // readable by the host or a confirmed participant — otherwise any
        // authenticated user could enumerate game ids and read the team
        // composition + ELO movement of private games. 404 (not 403) so the
        // endpoint never confirms an invite-only game exists to outsiders,
        // matching the invite-only access model GamesController enforces.
        $game = $this->gameRow($id);
        if ($game->visibility === 'invite') {
            $user = $this->authUser($request);
            $isAllowed = (string) $game->host_user_id === (string) $user->id
                || $this->isConfirmedParticipant($id, (string) $user->id);
            if (! $isAllowed) {
                throw ApiException::notFound('Scoring has not started');
            }
        }

        return $this->scoringResponse($id);
    }

    /**
     * Render the scoreboard payload without any access gate — the single
     * authoritative scoring response shape, reused by the gated route handler
     * scoring() and by every write path (startScoring/point/undo/complete/
     * reportResult) which has already enforced result-write access.
     */
    private function scoringResponse(string $id): JsonResponse
    {
        return response()->json($this->scorePayload($this->scoreRow($id)));
    }

    private function scoreRow(string $id): object
    {
        $row = DB::table('match_scores')->where('game_id', $id)->first();
        if ($row === null) {
            throw ApiException::notFound('Scoring has not started');
        }

        return $row;
    }

    private function gameRow(string $id): object
    {
        $game = DB::table('games')->where('id', $id)->whereNull('deleted_at')->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }

        return $game;
    }

    private function requireResultWriteAccess(object $game, string $gameId, string $userId): void
    {
        if ($this->canWriteResult($game, $gameId, $userId)) {
            return;
        }

        throw ApiException::forbidden('Only the host or a player with result access can record the result');
    }

    private function canWriteResult(object $game, string $gameId, string $userId): bool
    {
        if ((string) $game->host_user_id === $userId) {
            return true;
        }

        return DB::table('game_participants')
            ->where('game_id', $gameId)
            ->where('user_id', $userId)
            ->where('status', 'confirmed')
            ->where('can_report_result', true)
            ->exists();
    }

    private function isConfirmedParticipant(string $gameId, string $userId): bool
    {
        return DB::table('game_participants')
            ->where('game_id', $gameId)
            ->where('user_id', $userId)
            ->where('status', 'confirmed')
            ->exists();
    }

    private function confirmedParticipantIds(string $gameId): array
    {
        return DB::table('game_participants')
            ->where('game_id', $gameId)
            ->where('status', 'confirmed')
            ->pluck('user_id')
            ->map(fn ($id) => (string) $id)
            ->all();
    }

    private function assertValidTeams(string $gameId, array $teamA, array $teamB): void
    {
        $teamA = array_values(array_unique(array_map('strval', $teamA)));
        $teamB = array_values(array_unique(array_map('strval', $teamB)));
        if ($teamA === [] || $teamB === []) {
            throw ApiException::validation('Both teams must have players');
        }
        if (array_intersect($teamA, $teamB) !== []) {
            throw ApiException::validation('Players cannot be on both teams');
        }
        $participantIds = $this->confirmedParticipantIds($gameId);
        foreach (array_merge($teamA, $teamB) as $userId) {
            if (! in_array($userId, $participantIds, true)) {
                throw ApiException::validation('Team players must be confirmed game participants');
            }
        }
    }

    private function scorePayload(object $r): array
    {
        $sets = json_decode($r->sets ?? '[]', true) ?: [];
        $winning = $r->status === 'completed'
            ? $this->winnerFromSets($sets)
            : null;

        return [
            'game_id' => $r->game_id,
            'team_a_user_ids' => $this->pgArray($r->team_a_user_ids),
            'team_b_user_ids' => $this->pgArray($r->team_b_user_ids),
            'sets' => $sets,
            'current_set' => (int) $r->current_set,
            'current_game_a' => (int) $r->current_game_a,
            'current_game_b' => (int) $r->current_game_b,
            'point_a' => (int) $r->point_a,
            'point_b' => (int) $r->point_b,
            'status' => $r->status,
            'started_at' => $this->iso($r->started_at),
            'completed_at' => $this->iso($r->completed_at),
            'winning_team' => $winning,
            'elo_delta_by_user' => json_decode($r->elo_delta_by_user ?? '{}', true) ?: [],
        ];
    }

    private function minEloExpression(int $delta): Expression
    {
        $driver = DB::connection()->getDriverName();
        // Clamp BOTH ends to the DB CHECK (elo_rating BETWEEN 0 AND 4000): floor at
        // 100, ceiling at 4000. Without the upper clamp a high-rated winner could
        // push past 4000 and trigger a 23514 check_violation that aborts the whole
        // complete()/reportResult() transaction.
        if ($driver === 'sqlite') {
            return DB::raw('MAX(100, MIN(4000, elo_rating + ('.$delta.')))');
        }

        return DB::raw('GREATEST(100, LEAST(4000, elo_rating + ('.$delta.')))');
    }

    private function uuidArray(array $ids): Expression|string
    {
        $items = array_map(fn ($id) => '"'.str_replace('"', '\"', (string) $id).'"', $ids);
        $value = '{'.implode(',', $items).'}';

        if (DB::connection()->getDriverName() === 'sqlite') {
            return $value;
        }

        return DB::raw("'".$value."'::uuid[]");
    }

    private function pgArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $raw = trim((string) $value, '{}');
        if ($raw === '') {
            return [];
        }

        return array_map(fn ($v) => trim($v, '"'), explode(',', $raw));
    }

    private function auditWrite(?string $actorUserId, string $action, string $entity, ?string $entityId = null, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }
}
