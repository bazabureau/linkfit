<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Http\Controllers\Api\Concerns\ValidatesMediaUrls;
use App\Services\Notifications\PushDispatcher;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class SquadsController extends ApiController
{
    use FiltersBlockedUsers;
    use ValidatesMediaUrls;

    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:2', 'max:50'],
            'description' => ['nullable', 'string', 'max:500'],
            'photo_url' => ['nullable', 'url', 'max:2000'],
            'max_size' => ['required', 'integer', 'min:2', 'max:16'],
        ]);
        // photo_url is served verbatim to every squad member, so a free URL must
        // be https + on an allowlisted host (mirrors MeController profile photos /
        // chat attachments). The preferred path is a MediaController upload whose
        // returned URL is already on the media disk host.
        if (array_key_exists('photo_url', $data) && $data['photo_url'] !== null) {
            $data['photo_url'] = $this->assertAllowedMediaUrl($data['photo_url']);
        }
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $user, $data) {
            DB::table('squads')->insert([...$data, 'id' => $id, 'owner_id' => $user->id, 'created_at' => now()]);
            DB::table('squad_members')->insert(['squad_id' => $id, 'user_id' => $user->id, 'role' => 'owner', 'status' => 'active', 'joined_at' => now()]);
        });

        return $this->show($id, 201);
    }

    public function mine(Request $request): JsonResponse
    {
        $userId = (string) $this->authUser($request)->id;

        // Include squads the user is an ACTIVE member of as well as PENDING
        // invites (so invitations surface in "My Squads"). Newest squad first
        // (P3#93) so the most recently created/ joined teams head the list.
        $rows = DB::table('squad_members as m')
            ->join('squads as s', 's.id', '=', 'm.squad_id')
            ->where('m.user_id', $userId)
            ->whereIn('m.status', ['active', 'pending'])
            ->orderByDesc('s.created_at')
            ->get(['s.*', 'm.status as viewer_status', 'm.role as viewer_role']);

        // Batch the active-member COUNT for every listed squad into ONE GROUP BY
        // query (replaces the prior per-squad COUNT inside summary(), an N+1).
        $squadIds = $rows->pluck('id')->all();
        $memberCounts = empty($squadIds)
            ? collect()
            : DB::table('squad_members')
                ->whereIn('squad_id', $squadIds)
                ->where('status', 'active')
                ->groupBy('squad_id')
                ->selectRaw('squad_id, count(*) as cnt')
                ->pluck('cnt', 'squad_id');

        return response()->json(['squads' => $rows->map(fn ($s) => $this->summary(
            $s,
            (int) ($memberCounts[$s->id] ?? 0),
            // The caller's own membership row on this summary — the iOS client
            // reads viewer_status to flag a pending invite without a roster.
            viewerStatus: $s->viewer_status,
            viewerRole: $s->viewer_role,
        ))]);
    }

    /**
     * Route-facing show: only a member or invitee of the squad may view its
     * roster (which includes pending invites). `show()` itself stays ungated
     * because the write paths (store/update/invite/accept) reuse it after their
     * own authorization. 404 (not 403) avoids confirming a squad's existence.
     */
    public function showRoute(Request $request, string $id): JsonResponse
    {
        $userId = (string) $this->authUser($request)->id;
        $belongs = DB::table('squad_members')
            ->where('squad_id', $id)
            ->where('user_id', $userId)
            ->exists();
        if (! $belongs) {
            throw ApiException::notFound('Squad not found');
        }

        return $this->show($id);
    }

    public function show(string $id, int $status = 200): JsonResponse
    {
        $squad = DB::table('squads')->where('id', $id)->first();
        if ($squad === null) {
            throw ApiException::notFound('Squad not found');
        }
        $payload = $this->summary($squad);
        $payload['members'] = DB::table('squad_members as m')->join('users as u', 'u.id', '=', 'm.user_id')->where('m.squad_id', $id)->get(['m.user_id', 'u.display_name', 'u.photo_url', 'm.role', 'm.status', 'm.joined_at'])->map(fn ($m) => [
            'user_id' => $m->user_id,
            'display_name' => $m->display_name,
            'photo_url' => $m->photo_url,
            // iOS SquadMember requires a non-optional `is_owner` Bool.
            'is_owner' => $m->role === 'owner',
            'role' => $m->role,
            'status' => $m->status,
            'joined_at' => $this->iso($m->joined_at),
        ]);

        return response()->json($payload, $status);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $this->ownerOnly($request, $id);
        $data = $this->validateBody($request, [
            'name' => ['sometimes', 'string', 'min:2', 'max:50'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2000'],
        ]);
        // photo_url is served verbatim to every squad member, so a free URL must
        // be https + on an allowlisted host (mirrors MeController profile photos).
        if (array_key_exists('photo_url', $data) && $data['photo_url'] !== null) {
            $data['photo_url'] = $this->assertAllowedMediaUrl($data['photo_url']);
        }
        // A body with no recognized field yields []; Postgres rejects an empty
        // SET clause ("update ... set  where ...") with a syntax error. No-op.
        if ($data === []) {
            return $this->show($id);
        }
        DB::table('squads')->where('id', $id)->update($data);

        return $this->show($id);
    }

    public function invite(Request $request, string $id): JsonResponse
    {
        $owner = $this->authUser($request);
        $this->ownerOnly($request, $id);
        $data = $this->validateBody($request, ['user_id' => ['required', 'uuid', 'exists:users,id,deleted_at,NULL']]);

        // P2#54: never let an invite cross a block. A blocked user must not end
        // up sharing a squad with the person who blocked them, in EITHER
        // direction (forbid even when the BLOCKED user happens to be the owner).
        if ($this->blockExistsBetween((string) $owner->id, (string) $data['user_id'])) {
            throw ApiException::forbidden('Cannot invite this user');
        }

        // Whether we actually created a fresh pending row decides if a
        // notification fires — re-inviting someone already on the roster is a
        // silent no-op and must not re-notify them.
        $invited = false;

        // Enforce max_size (active + outstanding invites) under a row lock —
        // squad_members PK only blocks duplicates, not over-fill.
        DB::transaction(function () use ($id, $data, &$invited) {
            $squad = DB::table('squads')->where('id', $id)->lockForUpdate()->first(['max_size']);

            // Never demote an existing membership. A blind updateOrInsert keyed
            // on (squad_id, user_id) would rewrite an already-active member —
            // or the owner — back to role=member/status=pending, kicking them
            // out of the squad. Re-inviting someone already on the roster
            // (active or pending) is a harmless no-op.
            $alreadyOnRoster = DB::table('squad_members')
                ->where('squad_id', $id)
                ->where('user_id', $data['user_id'])
                ->exists();
            if ($alreadyOnRoster) {
                return;
            }

            $taken = DB::table('squad_members')
                ->where('squad_id', $id)
                ->whereIn('status', ['active', 'pending'])
                ->count();
            if ($squad !== null && $taken >= (int) $squad->max_size) {
                throw ApiException::conflict('Squad is full');
            }
            DB::table('squad_members')->insert([
                'squad_id' => $id,
                'user_id' => $data['user_id'],
                'role' => 'member',
                'status' => 'pending',
                'joined_at' => now(),
            ]);
            $invited = true;
        });

        // P0#8: surface the invite in the invitee's notification inbox and push
        // it to their devices. Fired AFTER the row commits so a rolled-back
        // transaction never leaks a notification for an invite that didn't land.
        if ($invited) {
            $squad = DB::table('squads')->where('id', $id)->first(['name']);
            $this->notifySquadInvite(
                (string) $data['user_id'],
                $id,
                (string) ($squad->name ?? 'a squad'),
                (string) $owner->id,
                (string) ($owner->display_name ?? 'Someone'),
            );
        }

        return $this->show($id);
    }

    public function accept(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        DB::transaction(function () use ($id, $user) {
            $squad = DB::table('squads')->where('id', $id)->lockForUpdate()->first(['max_size']);
            if ($squad === null) {
                throw ApiException::notFound('Squad not found');
            }

            // P2#55: the caller must hold a PENDING invite. Locking the row
            // here both serialises concurrent accepts and lets us distinguish
            // "no invite at all" (404) from "already active / not pending"
            // (409) — instead of the old silent 0-row UPDATE that returned 200
            // for a non-member.
            $membership = DB::table('squad_members')
                ->where('squad_id', $id)
                ->where('user_id', $user->id)
                ->lockForUpdate()
                ->first(['status']);
            if ($membership === null) {
                throw ApiException::notFound('Squad invite not found');
            }
            if ($membership->status !== 'pending') {
                throw ApiException::conflict('Squad invite is not pending');
            }

            $active = DB::table('squad_members')
                ->where('squad_id', $id)
                ->where('status', 'active')
                ->where('user_id', '!=', $user->id)
                ->count();
            if ($active >= (int) $squad->max_size) {
                throw ApiException::conflict('Squad is full');
            }
            DB::table('squad_members')->where('squad_id', $id)->where('user_id', $user->id)
                ->update(['status' => 'active', 'joined_at' => now()]);
        });

        return $this->show($id);
    }

    public function leave(Request $request, string $id): JsonResponse
    {
        $userId = (string) $this->authUser($request)->id;

        // P0#9: an owner leaving must not orphan the squad — squads requires
        // exactly one owner, and the squad row CASCADE-deletes its members. So
        // when the owner leaves we either hand the squad to the oldest active
        // member or, if there's nobody left to receive it, delete the squad.
        DB::transaction(function () use ($id, $userId) {
            $squad = DB::table('squads')->where('id', $id)->lockForUpdate()->first(['owner_id']);
            if ($squad === null) {
                // Already gone — leaving is idempotent. Nothing to orphan.
                return;
            }

            $isOwner = (string) $squad->owner_id === $userId;

            // Remove the caller's membership row first (no-op if they weren't on
            // the roster — e.g. a never-accepted invite they're declining).
            DB::table('squad_members')->where('squad_id', $id)->where('user_id', $userId)->delete();

            if (! $isOwner) {
                return;
            }

            // Owner left: promote the oldest remaining ACTIVE member to owner.
            // Pending invitees can't inherit a squad they never joined.
            $successor = DB::table('squad_members')
                ->where('squad_id', $id)
                ->where('status', 'active')
                ->where('user_id', '!=', $userId)
                ->orderBy('joined_at')
                ->orderBy('user_id')
                ->first(['user_id']);

            if ($successor === null) {
                // No active member to hand the squad to → deleting it is the only
                // non-orphaning outcome. CASCADE clears any leftover pending rows.
                DB::table('squads')->where('id', $id)->delete();

                return;
            }

            DB::table('squads')->where('id', $id)->update(['owner_id' => $successor->user_id]);
            DB::table('squad_members')
                ->where('squad_id', $id)
                ->where('user_id', $successor->user_id)
                ->update(['role' => 'owner']);
        });

        return response()->json(null, 204);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->ownerOnly($request, $id);
        DB::table('squads')->where('id', $id)->delete();

        return response()->json(null, 204);
    }

    public function games(Request $request, string $id): JsonResponse
    {
        // Only active members may read the squad's roster + game history.
        $isMember = DB::table('squad_members')
            ->where('squad_id', $id)
            ->where('user_id', (string) $this->authUser($request)->id)
            ->where('status', 'active')
            ->exists();
        if (! $isMember) {
            throw ApiException::notFound('Squad not found');
        }

        $members = DB::table('squad_members')->where('squad_id', $id)->where('status', 'active')->pluck('user_id');
        if ($members->isEmpty()) {
            return response()->json(['games' => []]);
        }

        // iOS SquadGamesResponse.games is [GameSummary], so emit the FULL
        // GameSummary shape (mirrors GamesController::summaryPayload): non-optional
        // sport_id, lat/lng (Double — cast from numeric), capacity,
        // participants_count, status, visibility are all required by the client.
        $rows = DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->join('users as u', 'u.id', '=', 'g.host_user_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->whereNull('g.deleted_at')
            ->whereIn('g.host_user_id', $members)
            // P2#56: the squad games feed surfaces games the squad can actually
            // see — public ones (and squad-scoped ones once that visibility
            // exists). A member's private invite-only games stay private and
            // must not leak into the shared feed.
            ->whereIn('g.visibility', ['public', 'squad'])
            ->orderByDesc('g.starts_at')
            ->limit(50)
            ->selectRaw("
                g.id, g.sport_id, s.slug as sport_slug, g.host_user_id,
                u.display_name as host_display_name, g.court_id,
                v.name as venue_name, v.photo_url as venue_photo_url,
                g.lat, g.lng, g.starts_at, g.duration_minutes, g.capacity,
                g.status, g.visibility, g.skill_min_elo, g.skill_max_elo,
                (select count(*) from game_participants gp where gp.game_id = g.id and gp.status = 'confirmed')::int as participants_count
            ")
            ->get();

        // Batch "how many squad members are attending each game" in ONE query
        // (replaces the prior per-game COUNT(*), an N+1 over the games list).
        $gameIds = $rows->pluck('id')->all();
        $attending = empty($gameIds)
            ? collect()
            : DB::table('game_participants')
                ->whereIn('game_id', $gameIds)
                ->whereIn('user_id', $members)
                ->where('status', 'confirmed')
                ->groupBy('game_id')
                ->selectRaw('game_id, count(*) as cnt')
                ->pluck('cnt', 'game_id');

        return response()->json(['games' => $rows->map(fn ($g) => [
            'id' => $g->id,
            'sport_id' => $g->sport_id,
            'sport_slug' => $g->sport_slug,
            'host_user_id' => $g->host_user_id,
            'host_display_name' => $g->host_display_name,
            'court_id' => $g->court_id,
            'venue_name' => $g->venue_name,
            'venue_photo_url' => $g->venue_photo_url,
            'lat' => (float) $g->lat,
            'lng' => (float) $g->lng,
            'starts_at' => $this->iso($g->starts_at),
            'duration_minutes' => (int) $g->duration_minutes,
            'capacity' => (int) $g->capacity,
            'participants_count' => (int) $g->participants_count,
            'status' => $g->status,
            'visibility' => $g->visibility,
            'skill_min_elo' => $g->skill_min_elo !== null ? (int) $g->skill_min_elo : null,
            'skill_max_elo' => $g->skill_max_elo !== null ? (int) $g->skill_max_elo : null,
            'distance_km' => null,
            // Squad-specific extra (ignored by the GameSummary decoder).
            'squad_members_attending' => (int) ($attending[$g->id] ?? 0),
        ])]);
    }

    private function ownerOnly(Request $request, string $id): void
    {
        $squad = DB::table('squads')->where('id', $id)->first();
        if ($squad === null) {
            throw ApiException::notFound('Squad not found');
        }
        if ($squad->owner_id !== $this->authUser($request)->id) {
            throw ApiException::forbidden('Only squad owner can change this squad');
        }
    }

    /**
     * Insert a notification row + queue a push for a squad invite (P0#8).
     *
     * `type` is the dedicated `squad.invited` enum value (added by the
     * 2026_06_21_000004 migration). The deep-link `route` and the squad id ride
     * in the JSON payload so the client can route the tap to /squads/{id}; the
     * push job mirrors the same shape for the background-tap deep link.
     */
    private function notifySquadInvite(string $inviteeId, string $squadId, string $squadName, string $inviterId, string $inviterName): void
    {
        $title = 'Squad invite';
        $body = "{$inviterName} invited you to join {$squadName}.";
        $payload = [
            'kind' => 'squad_invite',
            'route' => "/squads/{$squadId}",
            'squad_id' => $squadId,
            'squad_name' => $squadName,
            'inviter_user_id' => $inviterId,
        ];

        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $inviteeId,
            'type' => 'squad.invited',
            'title' => $title,
            'body' => $body,
            'payload' => json_encode($payload),
            'created_at' => now(),
        ]);

        if (Schema::hasTable('push_notification_jobs')) {
            DB::table('push_notification_jobs')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $inviteeId,
                'type' => 'squad.invited',
                'title' => $title,
                'body' => $body,
                'payload' => json_encode($payload),
                'status' => 'pending',
                'available_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            // Fire-and-forget: nudge the dispatcher so the invite pushes
            // promptly. Failures here must never bubble into the invite
            // response — the job stays queued for the worker to retry.
            try {
                app(PushDispatcher::class)->process(50);
            } catch (\Throwable) {
                // Swallowed by design; the queued job is the source of truth.
            }
        }
    }

    private function summary(object $s, ?int $memberCount = null, ?string $viewerStatus = null, ?string $viewerRole = null): array
    {
        $payload = [
            'id' => $s->id,
            // iOS Squad/SquadWithMembers decode `owner_user_id`; the DB column is `owner_id`.
            'owner_user_id' => $s->owner_id,
            'name' => $s->name,
            'description' => $s->description,
            'photo_url' => $s->photo_url,
            'max_size' => (int) $s->max_size,
            // Use a batched count when the caller precomputed one (mine()), else
            // fall back to a per-row COUNT (show()/update()/invite()/accept()).
            'member_count' => $memberCount ?? DB::table('squad_members')->where('squad_id', $s->id)->where('status', 'active')->count(),
            'created_at' => $this->iso($s->created_at),
        ];

        // P1#28: on summary rows (GET /squads/me) the response omits members[],
        // so carry the caller's own membership state inline. The iOS client
        // reads viewer_status to flag a pending invite without a roster; only
        // emitted when the caller plumbed it through (mine()), never on detail.
        if ($viewerStatus !== null) {
            $payload['viewer_status'] = $viewerStatus;
            $payload['viewer_role'] = $viewerRole;
        }

        return $payload;
    }
}
