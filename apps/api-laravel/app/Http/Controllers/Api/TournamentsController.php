<?php

namespace App\Http\Controllers\Api;

use App\Services\Launch\LaunchConfig;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class TournamentsController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'sport' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', 'string', 'max:40'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        if (! empty($query['sport']) && ! in_array($query['sport'], ['padel', 'tennis'], true)) {
            throw ApiException::validation('Unsupported sport');
        }

        $q = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            // Batch the per-tournament non-withdrawn entry count (was a per-row
            // COUNT fallback in payload()) via a grouped leftJoinSub, mirroring
            // CatalogController's aggregate pattern.
            ->leftJoinSub($this->entryCountAggregate(), 'ec', 'ec.tournament_id', '=', 't.id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when(! empty($query['sport']), fn ($q) => $q->where('s.slug', $query['sport']))
            ->when(! empty($query['status']), fn ($q) => $q->where('t.status', $query['status']))
            ->orderBy('t.starts_at')
            ->limit((int) ($query['limit'] ?? 50));

        return response()->json(['items' => $q->get(['t.*', 's.slug as sport_slug', 'v.name as venue_name', DB::raw('coalesce(ec.entries_count, 0) as entries_count')])->map(fn ($r) => $this->payload($r))]);
    }

    public function mine(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $rows = DB::table('tournament_entries as e')
            ->join('tournaments as t', 't.id', '=', 'e.tournament_id')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            // Match tournaments the user captains OR is a squad member of, so the
            // "Registered" state is correct for non-captain partners too.
            // player_ids is a native Postgres array → use = ANY(...), cast to
            // text[] to stay agnostic to uuid[] vs text[].
            ->where(function ($q) use ($user) {
                $q->where('e.captain_user_id', $user->id)
                    ->orWhereRaw('(?)::text = ANY(e.player_ids::text[])', [(string) $user->id]);
            })
            ->leftJoinSub($this->entryCountAggregate(), 'ec', 'ec.tournament_id', '=', 't.id')
            ->where('e.status', '!=', 'withdrawn')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('t.starts_at')
            ->get([
                't.*',
                's.slug as sport_slug',
                'v.name as venue_name',
                'e.id as entry_id',
                'e.status as entry_status',
                DB::raw('coalesce(ec.entries_count, 0) as entries_count'),
            ]);

        return response()->json(['items' => $rows->map(fn ($r) => $this->payload($r))]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $row = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->where('t.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['t.*', 's.slug as sport_slug', 'v.name as venue_name']);
        if ($row === null) {
            throw ApiException::notFound('Tournament not found');
        }
        $payload = $this->payload($row);
        // iOS TournamentEntry needs captain_display_name + player_names + a real
        // player_ids JSON array — none of which are on the raw entries row.
        $entries = DB::table('tournament_entries')
            ->where('tournament_id', $id)
            ->orderBy('created_at')
            ->get();

        // Batch every captain + player name/photo across ALL entries in ONE query
        // (replaces entryPayload's prior 2-queries-per-entry N+1).
        $userIds = [];
        foreach ($entries as $e) {
            $userIds[] = $e->captain_user_id;
            foreach ($this->parseUuidArray($e->player_ids ?? null) as $pid) {
                $userIds[] = $pid;
            }
        }
        $userMap = empty($userIds)
            ? collect()
            : DB::table('users')
                ->whereIn('id', array_values(array_unique($userIds)))
                ->get(['id', 'display_name', 'photo_url'])
                ->keyBy('id');

        $payload['entries'] = $entries
            ->map(fn ($e) => $this->entryPayload($e, $userMap))
            ->values();

        // iOS TournamentDetail requires a non-optional `can_register` Bool;
        // `my_entry` and `registration_blocked_reason` are optional personalization.
        $viewerId = $this->optionalViewerId($request);
        $canRegister = false;
        $blockedReason = null;
        if ($viewerId !== null) {
            try {
                $this->assertRegistrationOpen($row, $viewerId);
                $canRegister = true;
            } catch (ApiException $e) {
                $blockedReason = $e->getMessage();
            }
            $mine = DB::table('tournament_entries')
                ->where('tournament_id', $id)
                ->where('captain_user_id', $viewerId)
                ->where('status', '!=', 'withdrawn')
                ->first();
            $payload['my_entry'] = $mine !== null ? $this->entryPayload($mine) : null;
        } else {
            $blockedReason = $row->status !== 'registration_open'
                ? 'Tournament registration is closed'
                : null;
            $payload['my_entry'] = null;
        }
        $payload['can_register'] = $canRegister;
        $payload['registration_blocked_reason'] = $blockedReason;

        return response()->json($payload);
    }

    public function enter(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'squad_name' => ['sometimes', 'nullable', 'string', 'min:1', 'max:120'],
            'player_ids' => ['sometimes', 'array'],
            'player_ids.*' => ['uuid', 'distinct'],
        ]);
        // squad_name is optional for a mobile-first solo entry — default to the
        // captain's display name so the app can enter without a name-entry step.
        $data['squad_name'] = trim((string) ($data['squad_name'] ?? '')) ?: (trim((string) ($user->display_name ?? '')) ?: 'Squad');

        // Serialise concurrent registrations by locking the parent tournament
        // row before counting entries. Postgres forbids "count(*) ... FOR
        // UPDATE" (aggregate + row lock), so we lock the row, then count.
        $created = false;
        DB::transaction(function () use ($id, $user, $data, &$created) {
            DB::table('tournaments')->where('id', $id)->lockForUpdate()->first();

            $tournament = $this->tournamentRow($id);
            $this->assertRegistrationOpen($tournament, $user->id);
            // Waiver gate: tournaments flagged requires_waiver may only be entered
            // by a captain who has already signed the medical waiver for this
            // tournament (tournament_waivers is keyed by tournament_id + user_id).
            // Default-false flag → this is a no-op for every existing tournament.
            if ((bool) ($tournament->requires_waiver ?? false)) {
                $signed = DB::table('tournament_waivers')
                    ->where('tournament_id', $id)
                    ->where('user_id', $user->id)
                    ->exists();
                if (! $signed) {
                    throw ApiException::conflict('Waiver must be signed before entering');
                }
            }
            $playerIds = $this->validatedPlayerIds($data['player_ids'] ?? [], $user->id, (int) $tournament->squad_size);
            $existing = DB::table('tournament_entries')
                ->where('tournament_id', $id)
                ->where('captain_user_id', $user->id)
                ->first(['id', 'status']);

            if (
                DB::table('tournament_entries')
                    ->where('tournament_id', $id)
                    ->where('squad_name', $data['squad_name'])
                    ->when($existing !== null, fn ($q) => $q->where('id', '!=', $existing->id))
                    ->where('status', '!=', 'withdrawn')
                    ->exists()
            ) {
                throw ApiException::conflict('Squad name is already taken');
            }

            $entryId = (string) ($existing->id ?? Str::uuid());
            if ($existing === null) {
                DB::table('tournament_entries')->insert([
                    'id' => $entryId,
                    'tournament_id' => $id,
                    'captain_user_id' => $user->id,
                    'squad_name' => $data['squad_name'],
                    'player_ids' => $this->uuidArray($playerIds),
                    'status' => 'pending',
                    'created_at' => now(),
                ]);
                $action = 'tournament.entry.create';
                $created = true;
            } else {
                DB::table('tournament_entries')
                    ->where('id', $entryId)
                    ->where('captain_user_id', $user->id)
                    ->update([
                        'squad_name' => $data['squad_name'],
                        'player_ids' => $this->uuidArray($playerIds),
                        'status' => $existing->status === 'withdrawn' ? 'pending' : $existing->status,
                    ]);
                $action = 'tournament.entry.update';
            }
            $this->auditWrite($user->id, $action, 'tournament_entries', $entryId, [
                'tournament_id' => $id,
                'squad_name' => $data['squad_name'],
                'player_count' => count($playerIds) + 1,
            ]);
        });

        $entry = DB::table('tournament_entries')
            ->where('tournament_id', $id)
            ->where('captain_user_id', $user->id)
            ->first();
        // The entry was just written inside the committed transaction above; a
        // null here means it was removed out-of-band (cascade/concurrent op).
        // Fail with a clean 500 rather than passing null to entryPayload(object).
        if ($entry === null) {
            throw ApiException::internal('Tournament entry not found after registration');
        }

        // Confirmation notification + push for the captain on a fresh entry.
        // Wrapped so an enqueue failure can never fail tournament registration.
        if ($created) {
            try {
                $this->enqueueNotification(
                    (string) $user->id,
                    'system',
                    'Tournament entry confirmed',
                    'Your squad is registered for the tournament.',
                    ['kind' => 'tournament_entry', 'tournament_id' => $id, 'entry_id' => (string) ($entry->id ?? '')],
                );
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return response()->json($this->entryPayload($entry), 201);
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

    public function withdraw(Request $request, string $id, string $entryId): JsonResponse
    {
        $user = $this->authUser($request);
        $updated = DB::table('tournament_entries')
            ->where('tournament_id', $id)
            ->where('id', $entryId)
            ->where('captain_user_id', $user->id)
            ->update(['status' => 'withdrawn']);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament entry not found');
        }
        $this->auditWrite($user->id, 'tournament.entry.withdraw', 'tournament_entries', $entryId, [
            'tournament_id' => $id,
        ]);

        return response()->json(null, 204);
    }

    /**
     * DELETE /tournaments/{id}/entries — withdraw the viewer's own entry when
     * the client doesn't know the entry id. Resolves the captain's active entry
     * for this tournament, then delegates to withdraw().
     */
    public function withdrawMine(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $entryId = DB::table('tournament_entries')
            ->where('tournament_id', $id)
            ->where('captain_user_id', $user->id)
            ->where('status', '!=', 'withdrawn')
            ->orderByDesc('created_at')
            ->value('id');
        if ($entryId === null) {
            throw ApiException::notFound('Tournament entry not found');
        }

        return $this->withdraw($request, $id, (string) $entryId);
    }

    private function tournamentRow(string $id): object
    {
        $tournament = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->where('t.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['t.*']);
        if ($tournament === null) {
            throw ApiException::notFound('Tournament not found');
        }

        return $tournament;
    }

    private function assertRegistrationOpen(object $tournament, string $captainUserId): void
    {
        if ($tournament->status !== 'registration_open') {
            throw ApiException::conflict('Tournament registration is closed');
        }
        if ($tournament->registration_deadline !== null && CarbonImmutable::parse($tournament->registration_deadline)->isPast()) {
            throw ApiException::conflict('Tournament registration deadline has passed');
        }
        if (CarbonImmutable::parse($tournament->starts_at)->isPast()) {
            throw ApiException::conflict('Tournament has already started');
        }

        $existingActive = DB::table('tournament_entries')
            ->where('tournament_id', $tournament->id)
            ->where('captain_user_id', $captainUserId)
            ->where('status', '!=', 'withdrawn')
            ->exists();
        if ($existingActive) {
            return;
        }

        $activeEntries = DB::table('tournament_entries')
            ->where('tournament_id', $tournament->id)
            ->where('status', '!=', 'withdrawn')
            ->count();
        if ($activeEntries >= (int) $tournament->max_squads) {
            throw ApiException::conflict('Tournament is full');
        }
    }

    private function validatedPlayerIds(array $playerIds, string $captainUserId, int $squadSize): array
    {
        $playerIds = array_values(array_unique(array_filter($playerIds, fn ($uid) => is_string($uid) && $uid !== '')));
        $maxPlayers = max($squadSize - 1, 0);
        if (count($playerIds) > $maxPlayers) {
            throw ApiException::validation('Squad exceeds tournament size');
        }
        if (in_array($captainUserId, $playerIds, true)) {
            throw ApiException::validation('Captain cannot be listed as a player');
        }
        if ($playerIds !== []) {
            $existingUsers = DB::table('users')->whereIn('id', $playerIds)->count();
            if ($existingUsers !== count($playerIds)) {
                throw ApiException::validation('One or more players do not exist');
            }
        }

        return $playerIds;
    }

    private function uuidArray(array $ids)
    {
        $playerArray = '{'.implode(',', array_map(fn ($uid) => '"'.str_replace('"', '\"', $uid).'"', $ids)).'}';

        // Postgres (prod) stores player_ids as a native uuid[]; the `::uuid[]`
        // cast is invalid SQL on sqlite (test harness), where the column is a
        // plain text holding the same `{a,b}` literal parseUuidArray() reads back.
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return $playerArray;
        }

        return DB::raw("'".$playerArray."'::uuid[]");
    }

    private function entryPayload(object $e, $userMap = null): array
    {
        $playerIds = $this->parseUuidArray($e->player_ids ?? null);
        if ($userMap === null) {
            // Single-entry callers (enter / my_entry) fetch only their own ids in
            // one query — not an N+1. show()'s entry LIST passes a batched map.
            $ids = array_values(array_unique(array_merge($playerIds, [$e->captain_user_id])));
            $userMap = DB::table('users')->whereIn('id', $ids)->get(['id', 'display_name', 'photo_url'])->keyBy('id');
        }
        $playerNames = [];
        foreach ($playerIds as $pid) {
            $u = $userMap->get($pid);
            if ($u !== null) {
                $playerNames[] = (string) $u->display_name;
            }
        }
        $captain = $userMap->get($e->captain_user_id);

        return [
            'id' => $e->id,
            'tournament_id' => $e->tournament_id,
            'captain_user_id' => $e->captain_user_id,
            // iOS TournamentEntry: captain_display_name + player_names are required
            // (live on the users table, not tournament_entries).
            'captain_display_name' => $captain->display_name ?? '',
            'captain_photo_url' => $captain->photo_url ?? null,
            'squad_name' => $e->squad_name,
            'player_ids' => $playerIds,
            'player_names' => $playerNames,
            'status' => $e->status,
            'created_at' => $this->iso($e->created_at),
        ];
    }

    /**
     * Parse a Postgres uuid[] value (PDO returns it as a "{a,b}" literal
     * string) into a real array of UUID strings so it decodes as a JSON array.
     *
     * @return array<int,string>
     */
    private function parseUuidArray($raw): array
    {
        if ($raw === null) {
            return [];
        }
        if (is_array($raw)) {
            return array_values(array_filter(array_map('strval', $raw), fn ($v) => $v !== ''));
        }
        $trimmed = trim((string) $raw, '{}');
        if ($trimmed === '') {
            return [];
        }

        return array_values(array_filter(
            array_map(fn ($v) => trim($v, '" '), explode(',', $trimmed)),
            fn ($v) => $v !== ''
        ));
    }

    /**
     * Grouped per-tournament non-withdrawn entry count, joined into the list
     * queries so payload() reads the prefetched alias instead of a per-row COUNT.
     */
    private function entryCountAggregate()
    {
        return DB::table('tournament_entries')
            ->where('status', '!=', 'withdrawn')
            ->groupBy('tournament_id')
            ->select('tournament_id', DB::raw('count(*) as entries_count'));
    }

    private function payload(object $r): array
    {
        return [
            'id' => $r->id,
            'name' => $r->name,
            'description' => $r->description,
            'sport_id' => $r->sport_id,
            'sport_slug' => $r->sport_slug,
            'venue_id' => $r->venue_id,
            'venue_name' => $r->venue_name,
            'starts_at' => $this->iso($r->starts_at),
            'ends_at' => $this->iso($r->ends_at),
            'registration_deadline' => $this->iso($r->registration_deadline),
            'max_squads' => (int) $r->max_squads,
            'squad_size' => (int) $r->squad_size,
            'entry_fee_minor' => app(LaunchConfig::class)->monetizationEnabled() ? (int) $r->entry_fee_minor : 0,
            'currency' => $r->currency,
            'status' => $r->status,
            'entries_count' => isset($r->entries_count)
                ? (int) $r->entries_count
                : DB::table('tournament_entries')->where('tournament_id', $r->id)->where('status', '!=', 'withdrawn')->count(),
            'entry_id' => $r->entry_id ?? null,
            'entry_status' => $r->entry_status ?? null,
            'created_at' => $this->iso($r->created_at),
        ];
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
