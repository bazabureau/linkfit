<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class AmericanoController extends ApiController
{
    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        // Validate before insert: name/format/court_count/scoring_system are all
        // NOT NULL columns, so a missing field would be a 500 NOT-NULL violation
        // instead of a clean 422.
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'max:100'],
            'format' => ['sometimes', 'in:solo,team'],
            'court_count' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'scoring_system' => ['sometimes', 'string', 'max:30'],
        ]);
        $id = (string) Str::uuid();
        DB::table('americano_tournaments')->insert([
            'id' => $id,
            'name' => $data['name'],
            'format' => $data['format'] ?? 'solo',
            'host_id' => $user->id,
            'court_count' => $data['court_count'] ?? 1,
            'scoring_system' => $data['scoring_system'] ?? 'points',
            'status' => 'open',
            'created_at' => now(),
        ]);

        // Return the SAME enriched shape the list route emits (title /
        // teams_count / capacity / format=americano). The raw row only carries
        // `court_count`, but the client's Tournament decoder reads capacity from
        // `capacity`/`max_squads` — so a bare row renders the just-created
        // event's detail with a null capacity until the next refetch.
        return response()->json($this->listPayload(DB::table('americano_tournaments')->where('id', $id)->first()), 201);
    }

    /**
     * P0#10 — register a team in the tournament (host only, before the draw).
     *
     * `format=team` expects an explicit `display_name`. `format=solo` registers
     * the calling player as a one-person entry: the host is auto-added as their
     * own team (display_name defaults to the host's name) so a solo organiser
     * never has to also manually add themselves before starting. `user_id` is
     * persisted when the column exists so `mine()` can resolve joined events.
     */
    public function teams(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $tournament = DB::table('americano_tournaments')->where('id', $id)->first();
        if ($tournament === null) {
            throw ApiException::notFound('Americano tournament not found');
        }
        if ((string) $tournament->host_id !== (string) $user->id) {
            throw ApiException::forbidden('Only the tournament host can manage teams');
        }
        if ($tournament->status !== 'open') {
            // Teams are locked once the bracket is drawn — adding an entry after
            // the fixtures exist would leave that team without any matches.
            throw ApiException::conflict('Teams can only be added while the tournament is open');
        }

        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'max:100'],
        ]);

        $isSolo = ($tournament->format ?? 'solo') === 'solo';
        $displayName = trim((string) ($data['display_name'] ?? ''));
        if ($displayName === '') {
            if ($isSolo) {
                // Auto host team: fall back to the host's display name.
                $displayName = trim((string) ($user->display_name ?? '')) ?: 'Player';
            } else {
                throw ApiException::validation('A display_name is required for team entries', [
                    'issues' => ['display_name' => ['The display name field is required.']],
                ]);
            }
        }

        $hasUserId = Schema::hasColumn('americano_teams', 'user_id');

        // A solo player can only hold ONE entry in a tournament — guard against
        // a host double-registering themselves (which would skew the draw).
        if ($isSolo && $hasUserId) {
            $already = DB::table('americano_teams')
                ->where('tournament_id', $id)
                ->where('user_id', $user->id)
                ->exists();
            if ($already) {
                throw ApiException::conflict('You already have an entry in this tournament');
            }
        }

        $teamId = (string) Str::uuid();
        $row = [
            'id' => $teamId,
            'tournament_id' => $id,
            'display_name' => $displayName,
            'wins' => 0,
            'draws' => 0,
            'losses' => 0,
            'score' => 0,
        ];
        if ($hasUserId) {
            // For solo entries the team belongs to the registering player; team
            // entries are not owned by a single user, so user_id stays null.
            $row['user_id'] = $isSolo ? $user->id : null;
        }
        DB::table('americano_teams')->insert($row);

        return response()->json(DB::table('americano_teams')->where('id', $teamId)->first(), 201);
    }

    /**
     * P0#10 / P1#33 — draw the fixtures and move the tournament into play.
     *
     * Host only. Requires at least two teams. Generates a single round-robin so
     * every team plays every other exactly once, spreading matches across the
     * configured courts and numbering rounds with the circle method (so no team
     * plays twice in the same round). Transitions status open -> playing; a draw
     * is idempotent-safe in that re-running on a non-open tournament is rejected
     * rather than producing a duplicate bracket.
     */
    public function start(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $tournament = DB::table('americano_tournaments')->where('id', $id)->first();
        if ($tournament === null) {
            throw ApiException::notFound('Americano tournament not found');
        }
        if ((string) $tournament->host_id !== (string) $user->id) {
            throw ApiException::forbidden('Only the tournament host can start the tournament');
        }
        if ($tournament->status !== 'open') {
            throw ApiException::conflict('Tournament has already been started');
        }

        $teams = DB::table('americano_teams')
            ->where('tournament_id', $id)
            ->orderBy('id')
            ->get(['id']);
        if ($teams->count() < 2) {
            throw ApiException::conflict('At least two teams are required to start');
        }

        $fixtures = $this->roundRobinFixtures($teams->pluck('id')->all());
        $courtCount = max(1, (int) ($tournament->court_count ?? 1));

        DB::transaction(function () use ($id, $fixtures, $courtCount): void {
            // Lock the tournament row and re-read its status inside the
            // transaction. Two concurrent start() calls can both pass the
            // pre-transaction status==='open' check above; without this locked
            // re-check the loser would insert a SECOND copy of the bracket and
            // flip an already-`playing` event again. (Mirrors the locked
            // re-check in GamesController::join / BookingsController.)
            $locked = DB::table('americano_tournaments')->where('id', $id)->lockForUpdate()->first(['status']);
            if ($locked === null || $locked->status !== 'open') {
                throw ApiException::conflict('Tournament has already been started');
            }

            $now = now();
            $insertRows = [];
            foreach ($fixtures as $roundIndex => $round) {
                foreach (array_values($round) as $matchIndex => $pair) {
                    $insertRows[] = [
                        'id' => (string) Str::uuid(),
                        'tournament_id' => $id,
                        'court_name' => 'Court '.(($matchIndex % $courtCount) + 1),
                        'round_number' => $roundIndex + 1,
                        'team_a_id' => $pair[0],
                        'team_b_id' => $pair[1],
                        'score_a' => null,
                        'score_b' => null,
                        'status' => 'pending',
                        'created_at' => $now,
                    ];
                }
            }
            // Chunked insert keeps a large bracket within Postgres' bind-param
            // limit; americano_matches has no created_at in the legacy schema,
            // so strip it when the column is absent.
            $hasCreatedAt = Schema::hasColumn('americano_matches', 'created_at');
            foreach (array_chunk($insertRows, 200) as $chunk) {
                if (! $hasCreatedAt) {
                    $chunk = array_map(function ($r) {
                        unset($r['created_at']);

                        return $r;
                    }, $chunk);
                }
                DB::table('americano_matches')->insert($chunk);
            }

            DB::table('americano_tournaments')->where('id', $id)->update(['status' => 'playing']);
        });

        return response()->json($this->showPayload($id));
    }

    /**
     * Single round-robin schedule via the circle method. Returns an array of
     * rounds, each round a list of [teamA, teamB] id pairs. With an odd team
     * count a BYE is introduced and dropped, so a team simply sits out a round.
     *
     * @param  list<string>  $teamIds
     * @return list<list<array{0:string,1:string}>>
     */
    private function roundRobinFixtures(array $teamIds): array
    {
        $ids = array_values($teamIds);
        $bye = null;
        if (count($ids) % 2 === 1) {
            $bye = '__bye__';
            $ids[] = $bye;
        }

        $n = count($ids);
        $rounds = [];
        $fixed = $ids[0];
        $rotating = array_slice($ids, 1);

        for ($round = 0; $round < $n - 1; $round++) {
            $arrangement = array_merge([$fixed], $rotating);
            $pairs = [];
            for ($i = 0; $i < $n / 2; $i++) {
                $a = $arrangement[$i];
                $b = $arrangement[$n - 1 - $i];
                if ($a !== $bye && $b !== $bye) {
                    $pairs[] = [$a, $b];
                }
            }
            if ($pairs !== []) {
                $rounds[] = $pairs;
            }
            // Rotate all but the fixed element clockwise.
            array_unshift($rotating, array_pop($rotating));
        }

        return $rounds;
    }

    public function index(Request $request): JsonResponse
    {
        $this->authUser($request);
        $limit = min(max((int) $request->query('limit', 30), 1), 100);

        // P1#33 — the discovery list surfaces tournaments that are still
        // joinable or in progress. The status vocabulary is open|playing|
        // completed (see start()/score()); the old filter referenced a stale
        // 'in_progress' value that never existed in this table, so anything
        // past the draw silently dropped off the list. `completed` events are
        // intentionally excluded — they live under "my tournaments" / history.
        $rows = DB::table('americano_tournaments')
            ->whereIn('status', ['open', 'playing'])
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get();

        return response()->json(['items' => $rows->map(fn ($r) => $this->listPayload($r))->values()]);
    }

    public function mine(Request $request): JsonResponse
    {
        $userId = $this->authUser($request)->id;

        // Tournaments the user joined as a team member, in addition to the ones
        // they host. The team→user link lives on a `user_id` column of
        // `americano_teams`; it is detected at runtime so this stays a no-op
        // (host-only) on schemas that don't yet have that column.
        $joinedIds = collect();
        if (Schema::hasColumn('americano_teams', 'user_id')) {
            $joinedIds = DB::table('americano_teams')
                ->where('user_id', $userId)
                ->whereNotNull('tournament_id')
                ->pluck('tournament_id');
        }

        $rows = DB::table('americano_tournaments')
            ->where(function ($q) use ($userId, $joinedIds) {
                $q->where('host_id', $userId);
                if ($joinedIds->isNotEmpty()) {
                    $q->orWhereIn('id', $joinedIds->all());
                }
            })
            ->orderByDesc('created_at')
            ->get();

        return response()->json(['items' => $rows->map(fn ($r) => $this->listPayload($r))->values()]);
    }

    /**
     * Enrich a raw americano row with aliases generic Tournament clients read:
     * `title` (alias of name), `teams_count` (entries), `capacity` (court_count),
     * `format` forced to americano. Original keys are preserved.
     *
     * @return array<string,mixed>
     */
    private function listPayload(object $r): array
    {
        $teamsCount = (int) DB::table('americano_teams')->where('tournament_id', $r->id)->count();

        return array_merge((array) $r, [
            'title' => $r->name ?? null,
            'format' => 'americano',
            'teams_count' => $teamsCount,
            'entries_count' => $teamsCount,
            'capacity' => isset($r->court_count) ? (int) $r->court_count : null,
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->authUser($request);
        if (! DB::table('americano_tournaments')->where('id', $id)->exists()) {
            throw ApiException::notFound('Americano tournament not found');
        }

        return response()->json($this->showPayload($id));
    }

    /**
     * Build the AmericanoDetailsResponse the iOS/Flutter clients decode:
     * { tournament, teams, matches, leaderboard }. Shared by show() and start()
     * so a freshly-drawn bracket returns the exact same shape as a refetch.
     *
     * @return array<string,mixed>
     */
    private function showPayload(string $id): array
    {
        $row = DB::table('americano_tournaments')->where('id', $id)->first();
        $teams = DB::table('americano_teams')->where('tournament_id', $id)->get();

        // iOS AmericanoDetailsResponse requires a non-optional `leaderboard`
        // array of AmericanoLeaderboardEntry. Build it from the teams ordered
        // by score desc. The americano_teams table has no points columns, so
        // pointsScored / pointsConceded / pointsDifference are emitted as 0.
        // NOTE: those three keys are camelCase to match the Swift CodingKeys.
        $leaderboard = $teams
            ->sortByDesc(fn ($team) => (int) $team->score)
            ->values()
            ->map(fn ($team) => [
                'id' => (string) $team->id,
                'display_name' => (string) $team->display_name,
                'wins' => (int) $team->wins,
                'draws' => (int) $team->draws,
                'losses' => (int) $team->losses,
                'score' => (int) $team->score,
                'pointsScored' => 0,
                'pointsConceded' => 0,
                'pointsDifference' => 0,
            ])
            ->all();

        return [
            'tournament' => $row,
            'teams' => $teams,
            'matches' => DB::table('americano_matches')->where('tournament_id', $id)->get(),
            'leaderboard' => $leaderboard,
        ];
    }

    public function score(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'score_a' => ['required', 'integer', 'min:0', 'max:99'],
            'score_b' => ['required', 'integer', 'min:0', 'max:99'],
        ]);
        // Only the tournament host may score, and the match must exist.
        $match = DB::table('americano_matches as m')
            ->join('americano_tournaments as t', 't.id', '=', 'm.tournament_id')
            ->where('m.id', $id)
            ->first(['m.id', 'm.tournament_id', 'm.team_a_id', 'm.team_b_id', 't.host_id', 't.scoring_system', 't.status as tournament_status']);
        if ($match === null) {
            throw ApiException::notFound('Match not found');
        }
        if ((string) $match->host_id !== (string) $user->id) {
            throw ApiException::forbidden('Only the tournament host can submit scores');
        }

        // Recording the score AND recomputing both teams' standings is one
        // atomic step: the leaderboard (americano_teams.wins/draws/losses/score)
        // is what the client renders, and it was never being updated — so
        // completed matches left the standings frozen at zero. Recompute from
        // ALL of each team's completed matches so re-scoring a match is
        // idempotent (no double-counting) rather than incrementally applied.
        DB::transaction(function () use ($id, $data, $match) {
            // Lock the match row and re-read its status inside the transaction
            // before the read-then-write completion check below, closing the
            // race where two concurrent score() calls both see the same status.
            // A match that is ALREADY `completed` must not be silently
            // overwritten: reject result-tampering with a 409 so a finished
            // result can never be rewritten. First-time scoring is unaffected.
            $locked = DB::table('americano_matches')->where('id', $id)->lockForUpdate()->first(['status']);
            if ($locked !== null && $locked->status === 'completed') {
                throw ApiException::conflict('This match has already been scored');
            }

            DB::table('americano_matches')->where('id', $id)->update([
                'score_a' => $data['score_a'],
                'score_b' => $data['score_b'],
                'status' => 'completed',
            ]);
            $this->recomputeTeamStanding((string) $match->team_a_id, (string) $match->tournament_id, (string) $match->scoring_system);
            $this->recomputeTeamStanding((string) $match->team_b_id, (string) $match->tournament_id, (string) $match->scoring_system);

            // P1#33 — once every match in the bracket has a score, the
            // tournament is finished. Flip playing -> completed so it drops out
            // of the discovery list and the client shows final standings. Only
            // advance from `playing` so re-scoring a match in an already
            // completed event never bounces the status backwards.
            if ($match->tournament_status === 'playing') {
                $remaining = DB::table('americano_matches')
                    ->where('tournament_id', $match->tournament_id)
                    ->where('status', '!=', 'completed')
                    ->exists();
                if (! $remaining) {
                    DB::table('americano_tournaments')
                        ->where('id', $match->tournament_id)
                        ->update(['status' => 'completed']);
                }
            }
        });

        return response()->json(DB::table('americano_matches')->where('id', $id)->first());
    }

    /**
     * Rebuild one team's aggregate row from its completed matches. Derived (not
     * incremented) so it stays correct after an edit/re-score. `score` follows
     * the tournament's scoring_system: `points` sums the actual points the team
     * scored across its matches; otherwise it's a match-result tally
     * (win = 3, draw = 1) — the conventional Americano standing.
     */
    private function recomputeTeamStanding(string $teamId, string $tournamentId, string $scoringSystem): void
    {
        $matches = DB::table('americano_matches')
            ->where('tournament_id', $tournamentId)
            ->where('status', 'completed')
            ->where(function ($q) use ($teamId) {
                $q->where('team_a_id', $teamId)->orWhere('team_b_id', $teamId);
            })
            ->get(['team_a_id', 'team_b_id', 'score_a', 'score_b']);

        $wins = 0;
        $draws = 0;
        $losses = 0;
        $pointsFor = 0;
        foreach ($matches as $m) {
            $isA = (string) $m->team_a_id === $teamId;
            $own = (int) ($isA ? $m->score_a : $m->score_b);
            $opp = (int) ($isA ? $m->score_b : $m->score_a);
            $pointsFor += $own;
            if ($own > $opp) {
                $wins++;
            } elseif ($own < $opp) {
                $losses++;
            } else {
                $draws++;
            }
        }

        $score = $scoringSystem === 'points' ? $pointsFor : ($wins * 3 + $draws);
        DB::table('americano_teams')->where('id', $teamId)->update([
            'wins' => $wins,
            'draws' => $draws,
            'losses' => $losses,
            'score' => $score,
        ]);
    }
}
