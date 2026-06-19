<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\BlocksPendingGameResults;
use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class GamesController extends ApiController
{
    use BlocksPendingGameResults;
    use FiltersBlockedUsers;

    public function index(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'radius_km' => ['nullable', 'numeric', 'min:0.1', 'max:200'],
            'sport' => ['nullable', 'string', 'max:80'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'match_type' => ['nullable', 'in:casual,competitive'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
            'cursor' => ['nullable', 'string', 'max:500'],
        ]);
        if ((isset($query['lat']) || isset($query['lng']) || isset($query['radius_km']))
            && ! isset($query['lat'], $query['lng'], $query['radius_km'])) {
            throw ApiException::validation('lat, lng and radius_km must all be provided together');
        }
        if (! empty($query['sport']) && ! in_array($query['sport'], ['padel', 'tennis'], true)) {
            throw ApiException::validation('Unsupported sport');
        }

        $limit = (int) ($query['limit'] ?? 20);
        $cursor = $this->decodeCursor($query['cursor'] ?? null);
        $rows = $this->gameSummaryQuery($query)
            // Keyset on the (starts_at ASC, id ASC) order: rows strictly after the
            // cursor, so the app can page past the first screen (it already sends
            // ?cursor and reads next_cursor — the param used to be ignored).
            ->when($cursor !== null, fn ($q) => $q->where(function ($w) use ($cursor) {
                $w->where('g.starts_at', '>', $cursor['ts'])
                    ->orWhere(fn ($x) => $x->where('g.starts_at', $cursor['ts'])->where('g.id', '>', $cursor['id']));
            }))
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;
        $pageRows = $rows->take($limit)->values();

        // Batched roster fetch for the page (so list cards can show joined-player
        // avatars): one query for all confirmed participants of the listed games,
        // capped per game. Avoids an N+1 across the page.
        $participantsByGame = [];
        $gameIds = $pageRows->pluck('id')->all();
        if ($gameIds !== []) {
            $roster = DB::table('game_participants as gp')
                ->join('users as u', 'u.id', '=', 'gp.user_id')
                ->whereIn('gp.game_id', $gameIds)
                ->where('gp.status', 'confirmed')
                ->whereNull('u.deleted_at')
                ->orderBy('gp.joined_at')
                ->get(['gp.game_id', 'gp.user_id', 'u.display_name', 'u.photo_url']);
            foreach ($roster as $p) {
                $list = $participantsByGame[$p->game_id] ?? [];
                if (count($list) >= 8) {
                    continue;
                }
                $list[] = [
                    'user_id' => $p->user_id,
                    'display_name' => $p->display_name,
                    'photo_url' => $p->photo_url,
                    'status' => 'confirmed',
                ];
                $participantsByGame[$p->game_id] = $list;
            }
        }

        return response()->json([
            'items' => $pageRows->map(fn ($r) => $this->summaryPayload($r, $participantsByGame[$r->id] ?? []))->values(),
            'next_cursor' => $hasMore ? $this->encodeCursor($pageRows->last(), 'starts_at') : null,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $this->ensureNoPendingHostedGameResult((string) $user->id);
        // Freemium gate: free users have a monthly hosted-game cap (premium = unlimited).
        app(MembershipService::class)->ensureCanHostGame($user->id);
        $data = $this->validateBody($request, [
            'sport_id' => ['required', 'uuid'],
            'court_id' => ['sometimes', 'nullable', 'uuid'],
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'capacity' => ['sometimes', 'integer', 'min:2', 'max:40'],
            'skill_min_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'skill_max_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'visibility' => ['sometimes', 'in:public,invite'],
            'match_type' => ['sometimes', 'in:casual,competitive'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'idempotency_key' => ['sometimes', 'uuid'],
        ]);

        $sport = DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->first();
        if ($sport === null) {
            throw ApiException::validation('Unknown sport_id');
        }
        if (strtotime($data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        if (($data['skill_min_elo'] ?? null) !== null && ($data['skill_max_elo'] ?? null) !== null
            && $data['skill_min_elo'] > $data['skill_max_elo']) {
            throw ApiException::validation('skill_min_elo must be <= skill_max_elo');
        }

        $capacity = (int) ($data['capacity'] ?? $sport->max_players);
        if ($capacity < $sport->min_players || $capacity > $sport->max_players) {
            throw ApiException::validation("capacity for {$sport->name} must be between {$sport->min_players} and {$sport->max_players}");
        }

        if (! empty($data['court_id'])) {
            $court = DB::table('courts')->where('id', $data['court_id'])->first();
            if ($court === null) {
                throw ApiException::validation('Unknown court_id');
            }
            if ($court->sport_id !== $data['sport_id']) {
                throw ApiException::validation('Court sport does not match game sport');
            }
        }

        if (! empty($data['idempotency_key'])) {
            $existing = DB::table('games')
                ->where('host_user_id', $user->id)
                ->where('idempotency_key', $data['idempotency_key'])
                ->whereNull('deleted_at')
                ->first();
            if ($existing !== null) {
                return $this->show($existing->id);
            }
        }

        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $user, $data, $capacity) {
            DB::table('games')->insert([
                'id' => $id,
                'sport_id' => $data['sport_id'],
                'court_id' => $data['court_id'] ?? null,
                'host_user_id' => $user->id,
                'lat' => $data['lat'],
                'lng' => $data['lng'],
                'starts_at' => $data['starts_at'],
                'duration_minutes' => $data['duration_minutes'],
                'capacity' => $capacity,
                'skill_min_elo' => $data['skill_min_elo'] ?? null,
                'skill_max_elo' => $data['skill_max_elo'] ?? null,
                'visibility' => $data['visibility'] ?? 'public',
                'match_type' => $data['match_type'] ?? 'casual',
                'notes' => $data['notes'] ?? null,
                'idempotency_key' => $data['idempotency_key'] ?? null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('game_participants')->insert([
                'game_id' => $id,
                'user_id' => $user->id,
                'status' => 'confirmed',
                'joined_at' => now(),
                'status_changed_at' => now(),
            ]);
        });

        return $this->show($id, 201);
    }

    public function show(string $id, int $status = 200): JsonResponse
    {
        if (preg_match('/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i', $id, $matches) === 1) {
            $id = $matches[0];
        }

        $row = $this->gameSummaryQuery(['detail' => true])
            ->when(
                preg_match('/^[0-9a-f]{8}$/i', $id) === 1,
                fn ($q) => $q->whereRaw('g.id::text ilike ?', [$id.'%']),
                fn ($q) => $q->where('g.id', $id),
            )
            ->first();
        if ($row === null) {
            throw ApiException::notFound('Game not found');
        }
        $id = (string) $row->id;

        $payload = $this->summaryPayload($row);
        $payload['notes'] = $row->notes;
        $payload['created_at'] = $this->iso($row->created_at);
        $payload['participants'] = DB::table('game_participants as gp')
            ->join('users as u', 'u.id', '=', 'gp.user_id')
            ->where('gp.game_id', $id)
            ->orderBy('gp.joined_at')
            ->get(['gp.user_id', 'u.username', 'u.display_name', 'u.photo_url', 'gp.status', 'gp.joined_at'])
            ->map(fn ($p) => [
                'user_id' => $p->user_id,
                'username' => $p->username ?? null,
                'display_name' => $p->display_name,
                'photo_url' => $p->photo_url,
                'status' => $p->status,
                'joined_at' => $this->iso($p->joined_at),
            ]);

        return response()->json($payload, $status);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = DB::table('games')->where('id', $id)->whereNull('deleted_at')->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if ($game->host_user_id !== $user->id) {
            throw ApiException::forbidden('Only the host can update this game');
        }

        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
            'skill_min_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'skill_max_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'cancel' => ['sometimes', 'accepted'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        if (($data['cancel'] ?? false) === true) {
            DB::table('games')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now()]);

            return $this->show($id);
        }

        unset($data['cancel']);
        $data['updated_at'] = now();
        DB::table('games')->where('id', $id)->update($data);

        return $this->show($id);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->hostOnly($request, $id);
        DB::table('games')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);

        return response()->json(null, 204);
    }

    public function join(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->ensureNoPendingHostedGameResult((string) $user->id);
        $game = DB::table('games')->where('id', $id)->whereNull('deleted_at')->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if (! in_array($game->status, ['open', 'full'], true)) {
            throw ApiException::conflict('Game is not joinable');
        }
        if ($this->isBlockedBy((string) $user->id, (string) $game->host_user_id)) {
            throw ApiException::forbidden('You cannot join this game');
        }

        DB::transaction(function () use ($id, $user, $game) {
            // Serialise concurrent joins by locking the games row. PostgreSQL
            // forbids "SELECT count(*) ... FOR UPDATE" (aggregate + row lock),
            // so we lock the parent row and then count without a lock.
            DB::table('games')->where('id', $id)->lockForUpdate()->first();
            $count = DB::table('game_participants')->where('game_id', $id)->where('status', 'confirmed')->count();
            if ($count >= $game->capacity) {
                throw ApiException::conflict('Game is full');
            }
            DB::table('game_participants')->updateOrInsert(
                ['game_id' => $id, 'user_id' => $user->id],
                ['status' => 'confirmed', 'status_changed_at' => now(), 'joined_at' => now()],
            );
            $next = DB::table('game_participants')->where('game_id', $id)->where('status', 'confirmed')->count();
            DB::table('games')->where('id', $id)->update(['status' => $next >= $game->capacity ? 'full' : 'open', 'updated_at' => now()]);
        });
        if ($game->host_user_id !== $user->id) {
            $this->enqueueNotification((string) $game->host_user_id, 'game_joined', 'Player joined', 'A player joined your game.', ['game_id' => $id, 'user_id' => $user->id]);
        }

        return $this->show($id);
    }

    public function leave(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = DB::table('games')->where('id', $id)->whereNull('deleted_at')->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if ($game->host_user_id === $user->id) {
            throw ApiException::validation('Host cannot leave their own game');
        }

        DB::table('game_participants')
            ->where('game_id', $id)
            ->where('user_id', $user->id)
            ->update(['status' => 'cancelled', 'status_changed_at' => now()]);
        DB::table('games')->where('id', $id)->where('status', 'full')->update(['status' => 'open', 'updated_at' => now()]);
        $this->enqueueNotification((string) $game->host_user_id, 'game_cancelled', 'Player left', 'A player left your game.', ['game_id' => $id, 'user_id' => $user->id]);

        return $this->show($id);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $game = $this->hostOnly($request, $id);
        DB::table('games')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now()]);
        $participants = DB::table('game_participants')->where('game_id', $id)->where('status', 'confirmed')->pluck('user_id');
        foreach ($participants as $userId) {
            if ((string) $userId !== (string) $game->host_user_id) {
                $this->enqueueNotification((string) $userId, 'game_cancelled', 'Game cancelled', 'A game you joined was cancelled.', ['game_id' => $id]);
            }
        }

        return response()->json(null, 204);
    }

    public function reschedule(Request $request, string $id): JsonResponse
    {
        $this->hostOnly($request, $id);
        $data = $this->validateBody($request, [
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
        ]);
        if (strtotime($data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        $data['updated_at'] = now();
        DB::table('games')->where('id', $id)->update($data);

        return $this->show($id);
    }

    public function noShow(Request $request, string $id, string $uid): JsonResponse
    {
        $this->hostOnly($request, $id);
        DB::table('game_participants')
            ->where('game_id', $id)
            ->where('user_id', $uid)
            ->update(['status' => 'no_show', 'status_changed_at' => now()]);

        return $this->show($id);
    }

    private function hostOnly(Request $request, string $id): object
    {
        $user = $this->authUser($request);
        $game = DB::table('games')->where('id', $id)->whereNull('deleted_at')->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if ($game->host_user_id !== $user->id) {
            throw ApiException::forbidden('Only the host can change this game');
        }

        return $game;
    }

    private function gameSummaryQuery(array $filters)
    {
        $q = DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->join('users as u', 'u.id', '=', 'g.host_user_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('player_sport_stats as hps', function ($join) {
                $join->on('hps.user_id', '=', 'g.host_user_id')
                    ->on('hps.sport_id', '=', 'g.sport_id');
            })
            ->whereNull('g.deleted_at')
            ->whereNull('u.deleted_at')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->selectRaw("
                g.id, g.sport_id, s.slug as sport_slug, g.host_user_id,
                u.username as host_username, u.display_name as host_display_name, u.photo_url as host_photo_url,
                hps.elo_rating as host_elo, g.court_id, c.name as court_name,
                c.hourly_price_minor, c.currency,
                v.id as venue_id, v.name as venue_name, v.address as venue_address,
                v.photo_url as venue_photo_url, g.lat, g.lng, g.starts_at,
                g.duration_minutes, g.capacity, g.status, g.visibility, g.match_type,
                g.skill_min_elo, g.skill_max_elo, g.notes, g.created_at,
                (select count(*) from game_participants gp where gp.game_id = g.id and gp.status = 'confirmed')::int as participants_count
            ");

        if (! empty($filters['sport'])) {
            $q->where('s.slug', $filters['sport']);
        }
        if (! empty($filters['match_type'])) {
            $q->where('g.match_type', $filters['match_type']);
        }
        if (! empty($filters['from'])) {
            $q->where('g.starts_at', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $q->where('g.starts_at', '<=', $filters['to']);
        }
        if (isset($filters['lat'], $filters['lng'], $filters['radius_km'])) {
            $lat = (float) $filters['lat'];
            $lng = (float) $filters['lng'];
            $meters = (float) $filters['radius_km'] * 1000;
            $q->selectRaw('earth_distance(ll_to_earth(?::float8, ?::float8), ll_to_earth(g.lat::float8, g.lng::float8))::text as distance_m', [$lat, $lng])
                ->whereRaw('earth_box(ll_to_earth(?::float8, ?::float8), ?) @> ll_to_earth(g.lat::float8, g.lng::float8)', [$lat, $lng, $meters])
                ->whereRaw('earth_distance(ll_to_earth(?::float8, ?::float8), ll_to_earth(g.lat::float8, g.lng::float8)) <= ?', [$lat, $lng, $meters]);
        } else {
            $q->selectRaw('null::text as distance_m');
        }

        if (($filters['detail'] ?? false) !== true) {
            $q->whereIn('g.status', ['open', 'full'])
                ->where('g.visibility', 'public');
        }

        return $q->orderBy('g.starts_at')->orderBy('g.id');
    }

    private function summaryPayload(object $r, array $participants = []): array
    {
        return [
            'id' => $r->id,
            'sport_id' => $r->sport_id,
            'sport_slug' => $r->sport_slug,
            'host_user_id' => $r->host_user_id,
            'host_display_name' => $r->host_display_name,
            // Nested host object consumed by the web client (game detail + discover cards).
            'host' => [
                'id' => $r->host_user_id,
                'username' => $r->host_username ?? null,
                'display_name' => $r->host_display_name,
                'photo_url' => $r->host_photo_url ?? null,
                'elo' => isset($r->host_elo) && $r->host_elo !== null ? (int) $r->host_elo : null,
            ],
            'court_id' => $r->court_id,
            'court_name' => $r->court_name ?? null,
            'venue_id' => $r->venue_id ?? null,
            'venue_name' => $r->venue_name,
            'venue_address' => $r->venue_address ?? null,
            'venue_photo_url' => $r->venue_photo_url,
            'lat' => (float) $r->lat,
            'lng' => (float) $r->lng,
            'starts_at' => $this->iso($r->starts_at),
            'duration_minutes' => (int) $r->duration_minutes,
            'capacity' => (int) $r->capacity,
            'participants_count' => (int) $r->participants_count,
            'status' => $r->status,
            'visibility' => $r->visibility,
            'match_type' => $r->match_type ?? 'casual',
            'skill_min_elo' => $r->skill_min_elo !== null ? (int) $r->skill_min_elo : null,
            'skill_max_elo' => $r->skill_max_elo !== null ? (int) $r->skill_max_elo : null,
            'distance_km' => $r->distance_m !== null ? round(((float) $r->distance_m) / 1000, 2) : null,
            'price_minor' => $this->perPlayerPriceMinor($r),
            'total_minor' => $this->totalPriceMinor($r),
            'currency' => $r->currency ?? 'AZN',
            'participants' => $participants,
        ];
    }

    private function totalPriceMinor(object $r): ?int
    {
        if ($r->hourly_price_minor === null) {
            return null;
        }

        return (int) round(((int) $r->hourly_price_minor) * ((int) ($r->duration_minutes ?? 60)) / 60);
    }

    private function perPlayerPriceMinor(object $r): ?int
    {
        $total = $this->totalPriceMinor($r);
        $capacity = (int) ($r->capacity ?? 0);
        if ($total === null || $capacity <= 0) {
            return null;
        }

        return (int) ceil($total / $capacity);
    }

    private function enqueueNotification(string $userId, string $type, string $title, string $body, array $payload = []): void
    {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'payload' => json_encode($payload),
            'created_at' => now(),
        ]);
        if (Schema::hasTable('push_notification_jobs')) {
            DB::table('push_notification_jobs')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $userId,
                'type' => $type,
                'title' => $title,
                'body' => $body,
                'payload' => json_encode($payload),
                'available_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
}
