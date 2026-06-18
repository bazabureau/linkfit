<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

        return response()->json([
            'items' => DB::table('americano_tournaments')
                ->whereIn('status', ['open', 'in_progress'])
                ->orderByDesc('created_at')
                ->limit($limit)
                ->get(),
        ]);
    }

    public function mine(Request $request): JsonResponse
    {
        return response()->json(['items' => DB::table('americano_tournaments')->where('host_id', $this->authUser($request)->id)->orderByDesc('created_at')->get()]);
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
