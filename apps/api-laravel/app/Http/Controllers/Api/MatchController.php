<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Database\Query\Expression;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MatchController extends ApiController
{
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
            if ($inserted) {
                DB::table('player_sport_stats')->insertOrIgnore([
                    'user_id' => $rating['rated_user_id'],
                    'sport_id' => $game->sport_id,
                    'updated_at' => now(),
                ]);
                DB::table('player_sport_stats')
                    ->where('user_id', $rating['rated_user_id'])
                    ->where('sport_id', $game->sport_id)
                    ->update([
                        'games_played' => DB::raw('games_played + 1'),
                        'games_won' => DB::raw($rating['outcome'] === 'win' ? 'games_won + 1' : 'games_won'),
                        'updated_at' => now(),
                    ]);
            }
        }

        return response()->json(['recorded' => $recorded, 'skipped_duplicates' => $skipped]);
    }

    public function startScoring(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = $this->gameRow($id);
        if ((string) $game->host_user_id !== (string) $user->id) {
            throw ApiException::forbidden('Only host can start scoring');
        }
        $data = $this->validateBody($request, [
            'team_a_user_ids' => ['required', 'array', 'min:1', 'max:4'],
            'team_b_user_ids' => ['required', 'array', 'min:1', 'max:4'],
        ]);
        $this->assertValidTeams($id, $data['team_a_user_ids'], $data['team_b_user_ids']);
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

        return $this->scoring($id);
    }

    public function point(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireParticipantScoringAccess($id, (string) $user->id);
        $data = $this->validateBody($request, ['team' => ['required', 'in:a,b']]);
        $row = $this->scoreRow($id);
        if ($row->status !== 'in_progress') {
            throw ApiException::conflict('Scoring is not in progress');
        }
        $points = json_decode($row->points ?? '[]', true) ?: [];
        $points[] = $data['team'];
        DB::table('match_scores')->where('game_id', $id)->update([
            'points' => json_encode($points),
            'point_a' => $row->point_a + ($data['team'] === 'a' ? 1 : 0),
            'point_b' => $row->point_b + ($data['team'] === 'b' ? 1 : 0),
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'match.scoring_point', 'match_scores', $id, [
            'team' => $data['team'],
        ]);

        return $this->scoring($id);
    }

    public function undo(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireParticipantScoringAccess($id, (string) $user->id);
        $row = $this->scoreRow($id);
        if ($row->status !== 'in_progress') {
            throw ApiException::conflict('Scoring is not in progress');
        }
        $points = json_decode($row->points ?? '[]', true) ?: [];
        $last = array_pop($points);
        DB::table('match_scores')->where('game_id', $id)->update([
            'points' => json_encode($points),
            'point_a' => max(0, $row->point_a - ($last === 'a' ? 1 : 0)),
            'point_b' => max(0, $row->point_b - ($last === 'b' ? 1 : 0)),
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'match.scoring_undo', 'match_scores', $id, [
            'team' => $last,
        ]);

        return $this->scoring($id);
    }

    public function complete(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireParticipantScoringAccess($id, (string) $user->id);
        $row = $this->scoreRow($id);
        if ($row->status !== 'in_progress') {
            throw ApiException::conflict('Scoring is not in progress');
        }
        DB::table('match_scores')->where('game_id', $id)->update([
            'status' => 'completed',
            'sets' => json_encode([['a' => (int) $row->current_game_a, 'b' => (int) $row->current_game_b]]),
            'completed_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('games')->where('id', $id)->update(['status' => 'completed', 'updated_at' => now()]);
        $this->auditWrite($user->id, 'match.scoring_complete', 'match_scores', $id, [
            'current_game_a' => (int) $row->current_game_a,
            'current_game_b' => (int) $row->current_game_b,
        ]);

        return $this->scoring($id);
    }

    public function scoring(string $id): JsonResponse
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

    private function requireParticipantScoringAccess(string $gameId, string $userId): void
    {
        $this->gameRow($gameId);
        if (! $this->isConfirmedParticipant($gameId, $userId)) {
            throw ApiException::forbidden('Only confirmed participants can update scoring');
        }
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
            ? (((int) $r->current_game_a >= (int) $r->current_game_b) ? 'a' : 'b')
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

    private function uuidArray(array $ids): Expression
    {
        $items = array_map(fn ($id) => '"'.str_replace('"', '\"', (string) $id).'"', $ids);

        return DB::raw("'".'{'.implode(',', $items).'}'."'::uuid[]");
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
