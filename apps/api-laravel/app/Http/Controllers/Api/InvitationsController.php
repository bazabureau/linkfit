<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class InvitationsController extends ApiController
{
    use FiltersBlockedUsers;

    public function create(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, ['invitee_user_id' => ['required', 'uuid']]);
        $game = DB::table('games')->where('id', $id)->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if ($game->host_user_id !== $user->id) {
            throw ApiException::forbidden('Only host can invite players');
        }
        if ($data['invitee_user_id'] === $user->id) {
            throw ApiException::validation('Cannot invite yourself');
        }
        if ($this->blockExistsBetween((string) $user->id, (string) $data['invitee_user_id'])) {
            throw ApiException::forbidden('Cannot invite this user');
        }

        $inviteId = (string) Str::uuid();
        DB::table('game_invitations')->insertOrIgnore([
            'id' => $inviteId,
            'game_id' => $id,
            'inviter_user_id' => $user->id,
            'invitee_user_id' => $data['invitee_user_id'],
            'status' => 'pending',
            'created_at' => now(),
        ]);
        $this->enqueueNotification($data['invitee_user_id'], 'tournament_invite', 'Game invite', 'You were invited to a game.', ['kind' => 'game_invite', 'game_id' => $id, 'inviter_user_id' => $user->id]);

        return response()->json($this->payload(DB::table('game_invitations')->where('game_id', $id)->where('invitee_user_id', $data['invitee_user_id'])->where('status', 'pending')->first()), 201);
    }

    public function batch(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $game = DB::table('games')->where('id', $id)->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }
        if ($game->host_user_id !== $user->id) {
            throw ApiException::forbidden('Only host can invite players');
        }
        $sent = 0;
        $blocked = 0;
        foreach ((array) $request->input('user_ids', []) as $uid) {
            if ($uid === $user->id || $this->blockExistsBetween((string) $user->id, (string) $uid)) {
                $blocked++;

                continue;
            }
            $inserted = DB::table('game_invitations')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'game_id' => $id,
                'inviter_user_id' => $user->id,
                'invitee_user_id' => $uid,
                'status' => 'pending',
                'created_at' => now(),
            ]);
            if ($inserted) {
                $this->enqueueNotification((string) $uid, 'tournament_invite', 'Game invite', 'You were invited to a game.', ['kind' => 'game_invite', 'game_id' => $id, 'inviter_user_id' => $user->id]);
                $sent++;
            } else {
                $blocked++;
            }
        }

        return response()->json(['sent' => $sent, 'blocked' => $blocked]);
    }

    public function mine(Request $request): JsonResponse
    {
        $status = $request->query('status');
        $q = DB::table('game_invitations')->where('invitee_user_id', $this->authUser($request)->id)->orderByDesc('created_at');
        if ($status) {
            $q->where('status', $status);
        }

        return response()->json(['items' => $q->limit(100)->get()->map(fn ($r) => $this->payload($r))]);
    }

    public function accept(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $inv = DB::table('game_invitations')->where('id', $id)->where('invitee_user_id', $user->id)->first();
        if ($inv === null) {
            throw ApiException::notFound('Invitation not found');
        }
        DB::transaction(function () use ($inv, $user) {
            DB::table('game_invitations')->where('id', $inv->id)->update(['status' => 'accepted', 'responded_at' => now()]);
            DB::table('game_participants')->updateOrInsert(
                ['game_id' => $inv->game_id, 'user_id' => $user->id],
                ['status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            );
        });
        $fresh = DB::table('game_invitations')->where('id', $id)->first();

        return response()->json(['invitation' => $this->payload($fresh), 'game_id' => $fresh->game_id]);
    }

    public function decline(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // Scope to the caller's own invitation FIRST — never read/act on another
        // user's invitation (the previous code leaked it on a 0-row update).
        $inv = DB::table('game_invitations')->where('id', $id)->where('invitee_user_id', $user->id)->first();
        if ($inv === null) {
            throw ApiException::notFound('Invitation not found');
        }
        DB::table('game_invitations')->where('id', $id)->where('invitee_user_id', $user->id)
            ->update(['status' => 'declined', 'responded_at' => now()]);
        $fresh = DB::table('game_invitations')->where('id', $id)->where('invitee_user_id', $user->id)->first();

        return response()->json(['invitation' => $this->payload($fresh)]);
    }

    private function payload(object $r): array
    {
        $inviter = DB::table('users')->where('id', $r->inviter_user_id)->first();
        $game = DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->join('users as u', 'u.id', '=', 'g.host_user_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('g.id', $r->game_id)
            ->first(['g.*', 's.slug as sport_slug', 'u.display_name as host_display_name', 'v.name as venue_name']);

        return [
            'id' => $r->id,
            'game_id' => $r->game_id,
            'inviter_user_id' => $r->inviter_user_id,
            'inviter_display_name' => $inviter->display_name ?? '',
            'inviter_photo_url' => $inviter->photo_url ?? null,
            'invitee_user_id' => $r->invitee_user_id,
            'status' => $r->status,
            'created_at' => $this->iso($r->created_at),
            'responded_at' => $this->iso($r->responded_at),
            'game' => [
                'id' => $game->id,
                'sport_id' => $game->sport_id,
                'sport_slug' => $game->sport_slug,
                'host_user_id' => $game->host_user_id,
                'host_display_name' => $game->host_display_name,
                'court_id' => $game->court_id,
                'venue_name' => $game->venue_name,
                'lat' => (float) $game->lat,
                'lng' => (float) $game->lng,
                'starts_at' => $this->iso($game->starts_at),
                'duration_minutes' => (int) $game->duration_minutes,
                'capacity' => (int) $game->capacity,
                'participants_count' => DB::table('game_participants')->where('game_id', $game->id)->where('status', 'confirmed')->count(),
                'status' => $game->status,
                'visibility' => $game->visibility,
            ],
        ];
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
