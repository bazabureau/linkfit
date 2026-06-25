<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\BlocksPendingGameResults;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SeriesController extends ApiController
{
    use BlocksPendingGameResults;

    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $this->ensureNoPendingGameResult((string) $user->id);
        // Validate before insert: every game_series column below is NOT NULL with
        // CHECK/FK constraints, so raw unvalidated input was a 500 (NOT-NULL / FK /
        // CHECK / uuid-cast violation) instead of a clean 422.
        $data = $this->validateBody($request, [
            'sport_id' => ['required', 'uuid', 'exists:sports,id'],
            'court_id' => ['sometimes', 'nullable', 'uuid', 'exists:courts,id'],
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'day_of_week' => ['required', 'integer', 'between:0,6'],
            'time_of_day' => ['required', 'date_format:H:i,H:i:s'],
            'duration_minutes' => ['required', 'integer', 'between:15,480'],
            'capacity' => ['required', 'integer', 'min:1', 'max:64'],
            'occurrences' => ['sometimes', 'integer', 'between:1,52'],
            'starts_on' => ['required', 'date_format:Y-m-d'],
            'ends_on' => ['required', 'date_format:Y-m-d', 'after_or_equal:starts_on'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $id = (string) Str::uuid();
        DB::table('game_series')->insert([
            'id' => $id,
            'host_user_id' => $user->id,
            'sport_id' => $data['sport_id'],
            'court_id' => $data['court_id'] ?? null,
            'lat' => $data['lat'],
            'lng' => $data['lng'],
            'day_of_week' => $data['day_of_week'],
            'time_of_day' => $data['time_of_day'],
            'duration_minutes' => $data['duration_minutes'],
            'capacity' => $data['capacity'],
            'occurrences' => $data['occurrences'] ?? 1,
            'starts_on' => $data['starts_on'],
            'ends_on' => $data['ends_on'],
            'notes' => $data['notes'] ?? null,
            'created_at' => now(),
        ]);

        return response()->json($this->seriesPayload($id), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // IDOR gate (mirrors cancel()'s ownership check): a series exposes the
        // host's id, lat/lng, schedule and notes, so only the host or a confirmed
        // participant of one of its games may read it. Return 404 (not 403) so we
        // never confirm the existence of someone else's series.
        $series = DB::table('game_series')->where('id', $id)->first(['id', 'host_user_id']);
        if ($series === null) {
            throw ApiException::notFound('Series not found');
        }
        if ((string) $series->host_user_id !== (string) $user->id
            && ! $this->isSeriesParticipant($id, (string) $user->id)) {
            throw ApiException::notFound('Series not found');
        }

        return response()->json($this->seriesPayload($id));
    }

    /** True when the user is a confirmed participant of any game in this series. */
    private function isSeriesParticipant(string $seriesId, string $userId): bool
    {
        return DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->where('g.series_id', $seriesId)
            ->where('gp.user_id', $userId)
            ->where('gp.status', 'confirmed')
            ->exists();
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // Only the series host may cancel it (and its future occurrences).
        $series = DB::table('game_series')->where('id', $id)->first(['id', 'host_user_id']);
        if ($series === null) {
            throw ApiException::notFound('Series not found');
        }
        if ((string) $series->host_user_id !== (string) $user->id) {
            throw ApiException::forbidden('Only the host can cancel this series');
        }
        // Cancelling the series template AND its future occurrences is one
        // logical operation: if the games update fails after the series row is
        // flipped, the series would read `cancelled` while its future games stay
        // active (and re-running cancel() can't fix it on a non-host caller).
        // Wrap both writes so either both land or neither does.
        $cancelledCount = DB::transaction(function () use ($id): int {
            DB::table('game_series')->where('id', $id)->update(['status' => 'cancelled']);

            return (int) DB::table('games')
                ->where('series_id', $id)
                ->where('starts_at', '>=', now())
                ->update(['status' => 'cancelled', 'updated_at' => now()]);
        });

        return response()->json(['cancelled_count' => $cancelledCount]);
    }

    /**
     * Build the GameSeriesDetail payload the iOS client decodes: the series
     * template row joined to its sport slug + optional venue name, plus the
     * materialized games[] list (SeriesGameSummary shape). Numeric lat/lng are
     * cast to float (PDO returns Postgres numerics as strings) and timestamptz
     * columns are emitted as ISO8601 strings via $this->iso().
     */
    private function seriesPayload(string $id): array
    {
        $row = DB::table('game_series as gs')
            ->join('sports as s', 's.id', '=', 'gs.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'gs.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('gs.id', $id)
            ->selectRaw('
                gs.id, gs.host_user_id, gs.sport_id, s.slug as sport_slug,
                gs.court_id, v.name as venue_name, gs.lat, gs.lng,
                gs.day_of_week, gs.time_of_day, gs.duration_minutes, gs.capacity,
                gs.occurrences, gs.starts_on, gs.ends_on, gs.status, gs.notes,
                gs.created_at
            ')
            ->first();

        if ($row === null) {
            throw ApiException::notFound('Game series not found');
        }

        // Batch the per-game confirmed-participant count in ONE grouped subquery
        // joined once (mirrors TournamentsController::entryCountAggregate()),
        // instead of a correlated SELECT subquery that re-evaluated per game.
        $games = DB::table('games as g')
            ->leftJoinSub(
                DB::table('game_participants')
                    ->where('status', 'confirmed')
                    ->groupBy('game_id')
                    ->select('game_id', DB::raw('count(*) as participants_count')),
                'pc',
                'pc.game_id',
                '=',
                'g.id'
            )
            ->where('g.series_id', $id)
            ->orderBy('g.occurrence_number')
            ->selectRaw('
                g.id, g.occurrence_number, g.starts_at, g.status, g.capacity,
                coalesce(pc.participants_count, 0) as participants_count
            ')
            ->get()
            ->map(fn ($g) => [
                'id' => $g->id,
                'occurrence_number' => (int) $g->occurrence_number,
                'starts_at' => $this->iso($g->starts_at),
                'status' => $g->status,
                'capacity' => (int) $g->capacity,
                'participants_count' => (int) $g->participants_count,
            ])
            ->values();

        return [
            'id' => $row->id,
            'host_user_id' => $row->host_user_id,
            'sport_id' => $row->sport_id,
            'sport_slug' => $row->sport_slug,
            'court_id' => $row->court_id,
            'venue_name' => $row->venue_name,
            'lat' => (float) $row->lat,
            'lng' => (float) $row->lng,
            'day_of_week' => (int) $row->day_of_week,
            'time_of_day' => $row->time_of_day,
            'duration_minutes' => (int) $row->duration_minutes,
            'capacity' => (int) $row->capacity,
            'occurrences' => (int) $row->occurrences,
            'starts_on' => $row->starts_on,
            'ends_on' => $row->ends_on,
            'status' => $row->status,
            'notes' => $row->notes,
            'created_at' => $this->iso($row->created_at),
            'games' => $games,
        ];
    }
}
