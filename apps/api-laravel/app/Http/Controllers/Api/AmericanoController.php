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
        $id = (string) Str::uuid();
        DB::table('americano_tournaments')->insert([
            'id' => $id,
            'name' => $request->input('name'),
            'format' => $request->input('format', 'solo'),
            'host_id' => $user->id,
            'court_count' => $request->input('court_count', 1),
            'scoring_system' => $request->input('scoring_system', 'points'),
            'status' => 'open',
            'created_at' => now(),
        ]);

        return response()->json(DB::table('americano_tournaments')->where('id', $id)->first(), 201);
    }

    public function index(Request $request): JsonResponse
    {
        $this->authUser($request);
        $limit = min(max((int) $request->query('limit', 30), 1), 100);

        $rows = DB::table('americano_tournaments')
            ->whereIn('status', ['open', 'in_progress'])
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
        $row = DB::table('americano_tournaments')->where('id', $id)->first();
        if ($row === null) {
            throw ApiException::notFound('Americano tournament not found');
        }

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

        return response()->json([
            'tournament' => $row,
            'teams' => $teams,
            'matches' => DB::table('americano_matches')->where('tournament_id', $id)->get(),
            'leaderboard' => $leaderboard,
        ]);
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
            ->first(['m.id', 't.host_id']);
        if ($match === null) {
            throw ApiException::notFound('Match not found');
        }
        if ((string) $match->host_id !== (string) $user->id) {
            throw ApiException::forbidden('Only the tournament host can submit scores');
        }
        DB::table('americano_matches')->where('id', $id)->update([
            'score_a' => $data['score_a'],
            'score_b' => $data['score_b'],
            'status' => 'completed',
        ]);

        return response()->json(DB::table('americano_matches')->where('id', $id)->first());
    }
}
