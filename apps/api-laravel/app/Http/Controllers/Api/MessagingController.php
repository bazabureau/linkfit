<?php

namespace App\Http\Controllers\Api;

use App\Events\ConversationTyping;
use App\Events\ConversationUpdated;
use App\Events\MessageSent;
use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class MessagingController extends ApiController
{
    use AuthorizesAdminPermissions;
    use FiltersBlockedUsers;

    public function notifications(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string', 'max:500'],
        ]);
        $limit = (int) ($query['limit'] ?? 20);
        $cursor = $this->decodeCursor($query['cursor'] ?? null);

        $rows = DB::table('notifications')
            ->where('user_id', $user->id)
            ->when($cursor !== null, fn ($q) => $q->where(function ($w) use ($cursor) {
                $w->where('created_at', '<', $cursor['ts'])
                    ->orWhere(fn ($x) => $x->where('created_at', $cursor['ts'])->where('id', '<', $cursor['id']));
            }))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;
        $pageRows = $rows->take($limit)->values();

        return response()->json([
            'items' => $pageRows->map(fn ($n) => $this->notificationPayload($n))->values(),
            'next_cursor' => $hasMore ? $this->encodeCursor($pageRows->last(), 'created_at') : null,
            // unread_count is a whole-inbox figure — only on the first page.
            'unread_count' => $cursor === null
                ? DB::table('notifications')->where('user_id', $user->id)->whereNull('read_at')->count()
                : null,
        ]);
    }

    public function unreadCounts(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        $messages = DB::table('conversation_participants as me')
            ->join('conversations as c', 'c.id', '=', 'me.conversation_id')
            ->where('me.user_id', $user->id)
            ->whereNull('me.left_at')
            ->whereNotNull('c.last_message_at')
            // Mirror the inbox (conversations()): a 1:1 thread with a blocked
            // counterpart (either direction) is hidden, so it must NOT inflate
            // the badge — otherwise "messages: 1" points at a thread the user
            // can't see. Group threads are shared context and always count.
            ->where(function ($q) use ($user) {
                $q->where('c.kind', 'group')
                    ->orWhereNotExists(function ($sq) use ($user) {
                        $sq->selectRaw('1')
                            ->from('conversation_participants as other_cp')
                            ->join('user_blocks as ub', function ($join) use ($user) {
                                $join->where(fn ($w) => $w->where('ub.blocker_user_id', $user->id)->whereColumn('ub.blocked_user_id', 'other_cp.user_id'))
                                    ->orWhere(fn ($w) => $w->where('ub.blocked_user_id', $user->id)->whereColumn('ub.blocker_user_id', 'other_cp.user_id'));
                            })
                            ->whereColumn('other_cp.conversation_id', 'c.id')
                            ->whereColumn('other_cp.user_id', '!=', 'me.user_id');
                    });
            })
            ->where(function ($q) {
                $q->whereNull('me.last_read_at')
                    ->orWhereColumn('c.last_message_at', '>', 'me.last_read_at');
            })
            ->count();

        $notifications = DB::table('notifications')
            ->where('user_id', $user->id)
            ->whereNull('read_at')
            ->count();

        $invites = DB::table('game_invitations')
            ->where('invitee_user_id', $user->id)
            ->where('status', 'pending')
            ->count();

        return response()->json([
            'messages' => $messages,
            'notifications' => $notifications,
            'invites' => $invites,
            'total' => $messages + $notifications + $invites,
        ]);
    }

    public function markNotificationRead(Request $request, string $id): JsonResponse
    {
        DB::table('notifications')
            ->where('id', $id)
            ->where('user_id', $this->authUser($request)->id)
            ->update(['read_at' => now()]);

        return response()->json(null, 204);
    }

    public function markAllNotificationsRead(Request $request): JsonResponse
    {
        $updated = DB::table('notifications')
            ->where('user_id', $this->authUser($request)->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['updated' => $updated]);
    }

    public function deleteNotification(Request $request, string $id): JsonResponse
    {
        DB::table('notifications')
            ->where('id', $id)
            ->where('user_id', $this->authUser($request)->id)
            ->delete();

        return response()->json(null, 204);
    }

    public function deleteNotifications(Request $request): JsonResponse
    {
        DB::table('notifications')->where('user_id', $this->authUser($request)->id)->delete();

        return response()->json(null, 204);
    }

    public function conversations(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string', 'max:500'],
        ]);
        $limit = (int) ($query['limit'] ?? 20);
        $cursor = $this->decodeCursor($query['cursor'] ?? null);

        $rows = DB::table('conversation_participants as me')
            ->join('conversations as c', 'c.id', '=', 'me.conversation_id')
            ->join('conversation_participants as other_cp', function ($join) {
                $join->on('other_cp.conversation_id', '=', 'c.id')
                    ->whereColumn('other_cp.user_id', '!=', 'me.user_id');
            })
            ->join('users as other', 'other.id', '=', 'other_cp.user_id')
            ->where('me.user_id', $user->id)
            ->whereNull('me.left_at')
            // Hide 1:1 threads with a blocked user (either direction); group
            // (game/tournament) threads are shared context and stay visible.
            ->where(function ($q) use ($user) {
                $q->where('c.kind', 'group')
                    ->orWhereNotExists(function ($sq) use ($user) {
                        $sq->selectRaw('1')->from('user_blocks as ub2')
                            ->where(fn ($w) => $w->where('ub2.blocker_user_id', $user->id)->whereColumn('ub2.blocked_user_id', 'other.id'))
                            ->orWhere(fn ($w) => $w->where('ub2.blocked_user_id', $user->id)->whereColumn('ub2.blocker_user_id', 'other.id'));
                    });
            })
            // Keyset on (c.last_message_at DESC, c.id DESC); id-only fallback when
            // the cursor row had no last_message_at, so NULL-timestamped threads
            // still page deterministically.
            ->when($cursor !== null, fn ($q) => $q->where(function ($w) use ($cursor) {
                if ($cursor['ts'] === null || $cursor['ts'] === '') {
                    $w->where('c.id', '<', $cursor['id']);
                } else {
                    $w->where('c.last_message_at', '<', $cursor['ts'])
                        ->orWhere(fn ($x) => $x->where('c.last_message_at', $cursor['ts'])->where('c.id', '<', $cursor['id']));
                }
            }))
            ->orderByDesc('c.last_message_at')
            ->orderByDesc('c.id')
            ->limit($limit + 1)
            ->get([
                'c.id',
                'c.kind',
                'other.id as other_user_id',
                'other.display_name as other_display_name',
                'other.photo_url as other_photo_url',
                'other.last_seen_at as other_last_seen_at',
                'c.last_message_at',
                'me.last_read_at',
            ]);

        $hasMore = $rows->count() > $limit;
        $pageRows = $rows->take($limit)->values();

        // Batch the latest message for every listed conversation in ONE query
        // (Postgres DISTINCT ON) — replaces the prior per-row last-message lookup.
        $conversationIds = $pageRows->pluck('id')->all();
        $lastMessages = empty($conversationIds)
            ? collect()
            : DB::table('messages')
                ->whereIn('conversation_id', $conversationIds)
                ->orderBy('conversation_id')
                ->orderByDesc('created_at')
                ->distinct('conversation_id')
                ->get(['conversation_id', 'body', 'attachment_url', 'attachment_type', 'created_at'])
                ->keyBy('conversation_id');

        return response()->json([
            'items' => $pageRows->map(function ($r) use ($lastMessages) {
                $last = $lastMessages->get($r->id);

                return [
                    'id' => $r->id,
                    'kind' => $r->kind,
                    'other_user_id' => $r->other_user_id,
                    'other_display_name' => $r->other_display_name,
                    'other_photo_url' => $r->other_photo_url,
                    'other_last_seen_at' => $this->iso($r->other_last_seen_at),
                    'other_is_online' => $this->isOnline($r->other_last_seen_at),
                    'last_message_body' => $last->body ?? null,
                    'last_message_attachment_url' => $last->attachment_url ?? null,
                    'last_message_attachment_type' => $last->attachment_type ?? null,
                    'last_message_at' => $this->iso($r->last_message_at),
                    'unread' => $last !== null && ($r->last_read_at === null || $last->created_at > $r->last_read_at),
                ];
            })->values(),
            'next_cursor' => $hasMore ? $this->encodeCursor($pageRows->last(), 'last_message_at') : null,
        ]);
    }

    public function startConversation(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'other_user_id' => ['required', 'uuid'],
        ]);
        if ($data['other_user_id'] === $user->id) {
            throw ApiException::validation('Cannot start a conversation with yourself');
        }
        if (! DB::table('users')->where('id', $data['other_user_id'])->whereNull('deleted_at')->exists()) {
            throw ApiException::notFound('User not found');
        }
        if ($this->blockExistsBetween((string) $user->id, (string) $data['other_user_id'])) {
            throw ApiException::forbidden('Cannot message this user');
        }

        // Only match an existing DIRECT (1:1) conversation — never a group chat
        // (game/tournament/squad), which shares the same participant table.
        $existing = DB::table('conversation_participants as a')
            ->join('conversation_participants as b', 'b.conversation_id', '=', 'a.conversation_id')
            ->join('conversations as c', 'c.id', '=', 'a.conversation_id')
            ->where('a.user_id', $user->id)
            ->where('b.user_id', $data['other_user_id'])
            ->where(fn ($q) => $q->where('c.kind', 'direct')->orWhereNull('c.kind'))
            ->value('a.conversation_id');
        if ($existing !== null) {
            DB::table('conversation_participants')->where('conversation_id', $existing)->whereIn('user_id', [$user->id, $data['other_user_id']])->update(['left_at' => null]);
            $this->broadcastConversationUpdated((string) $existing, 'conversation_opened');

            return response()->json(['conversation_id' => $existing]);
        }

        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $user, $data) {
            DB::table('conversations')->insert(['id' => $id, 'kind' => 'direct', 'created_at' => now()]);
            DB::table('conversation_participants')->insert([
                ['conversation_id' => $id, 'user_id' => $user->id],
                ['conversation_id' => $id, 'user_id' => $data['other_user_id']],
            ]);
        });
        $this->broadcastConversationUpdated($id, 'conversation_created');

        return response()->json(['conversation_id' => $id]);
    }

    public function openGroupConversation(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'kind' => ['required', 'in:game,tournament'],
            'target_id' => ['required', 'uuid'],
        ]);
        $targetColumn = $data['kind'] === 'game' ? 'game_id' : 'tournament_id';
        $target = DB::table($data['kind'] === 'game' ? 'games' : 'tournaments')->where('id', $data['target_id'])->first();
        if ($target === null) {
            throw ApiException::notFound('Group target not found');
        }

        // Authorize membership BEFORE joining. Opening a group conversation inserts
        // the caller as a participant, granting read of full history + post + live
        // broadcast fan-out. Without this guard any authenticated user could
        // enumerate public game/tournament ids and self-join any group thread.
        // Allowed: the game host / a game participant, or a tournament captain /
        // listed player on a non-withdrawn entry.
        if ($data['kind'] === 'game') {
            $isMember = (string) $target->host_user_id === (string) $user->id
                || DB::table('game_participants')
                    ->where('game_id', $data['target_id'])
                    ->where('user_id', $user->id)
                    ->exists();
        } else {
            $isMember = DB::table('tournament_entries')
                ->where('tournament_id', $data['target_id'])
                ->where('status', '<>', 'withdrawn')
                ->where(function ($q) use ($user) {
                    $q->where('captain_user_id', $user->id)
                        ->orWhereRaw('?::uuid = ANY(player_ids)', [$user->id]);
                })
                ->exists();
        }
        if (! $isMember) {
            throw ApiException::forbidden('You are not a member of this group');
        }

        $existing = DB::table('conversations')->where('kind', 'group')->where($targetColumn, $data['target_id'])->first();
        $created = false;
        if ($existing === null) {
            $id = (string) Str::uuid();
            DB::table('conversations')->insert([
                'id' => $id,
                'kind' => 'group',
                'title' => $target->name ?? 'Group chat',
                $targetColumn => $data['target_id'],
                'created_at' => now(),
            ]);
            $created = true;
        } else {
            $id = $existing->id;
        }

        DB::table('conversation_participants')->updateOrInsert(
            ['conversation_id' => $id, 'user_id' => $user->id],
            ['left_at' => null]
        );
        $row = DB::table('conversations')->where('id', $id)->first();
        $this->broadcastConversationUpdated($id, $created ? 'conversation_created' : 'conversation_opened');

        return response()->json([
            'conversation_id' => $id,
            'kind' => $data['kind'],
            'title' => $row->title ?? 'Group chat',
            'game_id' => $row->game_id,
            'tournament_id' => $row->tournament_id,
            'participants_count' => DB::table('conversation_participants')->where('conversation_id', $id)->whereNull('left_at')->count(),
            'created' => $created,
        ], $created ? 201 : 200);
    }

    public function thread(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $participant = DB::table('conversation_participants')->where('conversation_id', $id)->where('user_id', $user->id)->whereNull('left_at')->exists();
        if (! $participant) {
            throw ApiException::forbidden('Conversation not available');
        }

        $conversation = DB::table('conversations')->where('id', $id)->first();
        if ($conversation === null) {
            throw ApiException::notFound('Conversation not found');
        }

        // Keep the most RECENT 500 messages, not the oldest. The client renders
        // ascending by created_at, so we take the newest window (DESC + limit)
        // then re-sort ascending — otherwise a thread past 500 messages would
        // pin to its oldest 500 and hide every recent message. Tie-break on id
        // so same-timestamp rows window deterministically.
        $messages = DB::table('messages')
            ->where('conversation_id', $id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(500)
            ->get()
            ->sortBy('created_at')
            ->values()
            ->map(fn ($m) => $this->messagePayload($m));

        // Group threads have no single "other" participant — a brand-new game
        // chat can even have just the host in it. The 1:1 lookup below would
        // 404 on those, which is exactly the bug that made group messages
        // impossible to read (and made a just-sent message vanish on reload).
        // The client sources names/avatars from the participants roster, so the
        // `other_*` fields are placeholders here; they only need to be non-null
        // to satisfy the shared ConversationThread decoder.
        if (($conversation->kind ?? 'direct') === 'group') {
            return response()->json([
                'conversation_id' => $id,
                'other_user_id' => $id,
                'other_display_name' => $conversation->title ?? 'Group chat',
                'other_last_seen_at' => null,
                'other_is_online' => false,
                'other_last_read_at' => null,
                'messages' => $messages,
            ]);
        }

        // 1:1 direct conversation — original behaviour, unchanged.
        $other = DB::table('conversation_participants as cp')
            ->join('users as u', 'u.id', '=', 'cp.user_id')
            ->where('cp.conversation_id', $id)
            ->where('cp.user_id', '!=', $user->id)
            ->first(['u.id', 'u.display_name', 'u.photo_url', 'u.last_seen_at', 'cp.last_read_at']);
        if ($other === null) {
            throw ApiException::notFound('Conversation not found');
        }

        return response()->json([
            'conversation_id' => $id,
            'other_user_id' => $other->id,
            'other_display_name' => $other->display_name,
            'other_photo_url' => $other->photo_url,
            'other_last_seen_at' => $this->iso($other->last_seen_at),
            'other_is_online' => $this->isOnline($other->last_seen_at),
            'other_last_read_at' => $this->iso($other->last_read_at),
            'messages' => $messages,
        ]);
    }

    public function participants(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $conversation = $this->groupConversationForParticipant($id, $user->id);
        $ownerId = $this->conversationOwnerId($conversation);

        return response()->json([
            'conversation_id' => $id,
            'kind' => 'group',
            'title' => $conversation->title ?? 'Group chat',
            'owner_user_id' => $ownerId,
            'items' => DB::table('conversation_participants as cp')
                ->join('users as u', 'u.id', '=', 'cp.user_id')
                ->where('cp.conversation_id', $id)
                ->whereNull('cp.left_at')
                ->orderBy('u.display_name')
                ->get(['cp.user_id', 'u.display_name', 'u.photo_url', 'cp.last_read_at'])
                ->map(fn ($p) => [
                    'user_id' => $p->user_id,
                    'display_name' => $p->display_name,
                    'photo_url' => $p->photo_url,
                    'is_owner' => $p->user_id === $ownerId,
                    'joined_at' => $this->iso($p->last_read_at),
                ]),
        ]);
    }

    public function addParticipant(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $conversation = $this->groupConversationForParticipant($id, $user->id);
        $adminAction = $this->conversationOwnerId($conversation) !== $user->id;
        if ($adminAction) {
            $this->requireAdminPermission($request, 'operations');
        }
        $data = $this->validateBody($request, ['user_id' => ['required', 'uuid']]);
        if (! DB::table('users')->where('id', $data['user_id'])->whereNull('deleted_at')->exists()) {
            throw ApiException::notFound('User not found');
        }
        $added = DB::table('conversation_participants')->updateOrInsert(
            ['conversation_id' => $id, 'user_id' => $data['user_id']],
            ['left_at' => null]
        );
        if ($adminAction) {
            $this->auditWrite($user->id, 'conversation.participant_add', 'conversations', $id, [
                'participant_user_id' => $data['user_id'],
            ]);
        }
        $this->broadcastConversationUpdated($id, 'participant_added');

        return response()->json([
            'added' => (bool) $added,
            'participants_count' => DB::table('conversation_participants')->where('conversation_id', $id)->whereNull('left_at')->count(),
        ]);
    }

    public function removeParticipant(Request $request, string $id, string $userId): JsonResponse
    {
        $user = $this->authUser($request);
        $conversation = $this->groupConversationForParticipant($id, $user->id);
        $adminAction = $this->conversationOwnerId($conversation) !== $user->id;
        if ($adminAction) {
            $this->requireAdminPermission($request, 'operations');
        }
        DB::table('conversation_participants')
            ->where('conversation_id', $id)
            ->where('user_id', $userId)
            ->update(['left_at' => now()]);
        if ($adminAction) {
            $this->auditWrite($user->id, 'conversation.participant_remove', 'conversations', $id, [
                'participant_user_id' => $userId,
            ]);
        }
        $this->broadcastConversationUpdated($id, 'participant_removed', [(string) $userId]);

        return response()->json(null, 204);
    }

    public function leave(Request $request, string $id): JsonResponse
    {
        $userId = (string) $this->authUser($request)->id;
        DB::table('conversation_participants')
            ->where('conversation_id', $id)
            ->where('user_id', $userId)
            ->whereNull('left_at')
            ->update(['left_at' => now()]);
        $this->broadcastConversationUpdated($id, 'participant_left', [$userId]);

        return response()->json(null, 204);
    }

    public function sendMessage(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if (! DB::table('conversation_participants')->where('conversation_id', $id)->where('user_id', $user->id)->whereNull('left_at')->exists()) {
            throw ApiException::forbidden('Conversation not available');
        }
        // In a 1:1 (direct) thread a block halts messaging both ways. Group
        // (game/tournament/squad) threads are shared context and stay open.
        $conv = DB::table('conversations')->where('id', $id)->first(['kind']);
        if ($conv === null || $conv->kind === null || $conv->kind === 'direct') {
            $otherId = DB::table('conversation_participants')
                ->where('conversation_id', $id)
                ->where('user_id', '!=', $user->id)
                ->value('user_id');
            if ($otherId !== null && $this->blockExistsBetween((string) $user->id, (string) $otherId)) {
                throw ApiException::forbidden('Cannot message this user');
            }
        }
        $data = $this->validateBody($request, [
            'body' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'attachment_url' => ['sometimes', 'nullable', 'string', 'max:2048'],
            'attachment_type' => ['sometimes', 'nullable', 'in:image,voice,video,audio'],
        ]);
        if (($data['attachment_type'] ?? null) === 'audio') {
            $data['attachment_type'] = 'voice';
        }
        $body = trim((string) ($data['body'] ?? ''));
        if ($body === '' && empty($data['attachment_url'])) {
            throw ApiException::validation('Message must have a body or an attachment');
        }
        $messageId = (string) Str::uuid();
        DB::table('messages')->insert([
            'id' => $messageId,
            'conversation_id' => $id,
            'sender_user_id' => $user->id,
            'body' => $body,
            'attachment_url' => $data['attachment_url'] ?? null,
            'attachment_type' => $data['attachment_type'] ?? null,
            'created_at' => now(),
        ]);
        $row = DB::table('messages')->where('id', $messageId)->first();
        $payload = $this->messagePayload($row);

        // Real-time fan-out to the other participants. Guarded + caught so a
        // broadcasting outage can NEVER fail message delivery (chat also polls).
        if (! in_array((string) config('broadcasting.default'), ['log', 'null', ''], true)) {
            try {
                broadcast(new MessageSent($id, $payload))->toOthers();
            } catch (\Throwable $e) {
                report($e);
            }
        }
        $this->broadcastConversationUpdated($id, 'message_sent');

        // Persisted notification + push for every OTHER active participant (group
        // threads notify all of them; a direct thread has exactly one). Wrapped so
        // an enqueue failure can NEVER fail message delivery.
        try {
            $recipients = DB::table('conversation_participants')
                ->where('conversation_id', $id)
                ->where('user_id', '!=', $user->id)
                ->whereNull('left_at')
                ->pluck('user_id');
            foreach ($recipients as $recipientId) {
                $this->enqueueNotification(
                    (string) $recipientId,
                    'message_received',
                    'New message',
                    $body !== '' ? $body : 'Sent an attachment',
                    ['conversation_id' => $id, 'sender_user_id' => $user->id],
                );
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return response()->json($payload, 201);
    }

    public function markConversationRead(Request $request, string $id): JsonResponse
    {
        DB::table('conversation_participants')
            ->where('conversation_id', $id)
            ->where('user_id', $this->authUser($request)->id)
            ->update(['last_read_at' => now()]);

        return response()->json(null, 204);
    }

    public function typing(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if (! DB::table('conversation_participants')->where('conversation_id', $id)->where('user_id', $user->id)->whereNull('left_at')->exists()) {
            throw ApiException::forbidden('Conversation not available');
        }
        $data = $this->validateBody($request, [
            'is_typing' => ['required', 'boolean'],
        ]);

        $this->broadcastTyping($id, (string) $user->id, (bool) $data['is_typing']);

        return response()->json(null, 204);
    }

    /**
     * @param  array<int,string>  $extraUserIds
     */
    private function broadcastConversationUpdated(string $conversationId, string $reason, array $extraUserIds = []): void
    {
        if (! $this->broadcastingEnabled()) {
            return;
        }

        $userIds = array_values(array_unique([...$this->activeParticipantIds($conversationId), ...$extraUserIds]));
        if ($userIds === []) {
            return;
        }

        try {
            broadcast(new ConversationUpdated($conversationId, $userIds, $reason));
        } catch (\Throwable $e) {
            report($e);
        }
    }

    private function broadcastTyping(string $conversationId, string $userId, bool $isTyping): void
    {
        if (! $this->broadcastingEnabled()) {
            return;
        }

        try {
            broadcast(new ConversationTyping($conversationId, $userId, $isTyping))->toOthers();
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * @return array<int,string>
     */
    private function activeParticipantIds(string $conversationId): array
    {
        return DB::table('conversation_participants')
            ->where('conversation_id', $conversationId)
            ->whereNull('left_at')
            ->pluck('user_id')
            ->map(fn ($id) => (string) $id)
            ->all();
    }

    private function broadcastingEnabled(): bool
    {
        return ! in_array((string) config('broadcasting.default'), ['log', 'null', ''], true);
    }

    private function isOnline(mixed $lastSeenAt): bool
    {
        if ($lastSeenAt === null) {
            return false;
        }

        $timestamp = strtotime((string) $lastSeenAt);

        return $timestamp !== false && $timestamp >= now()->subMinutes(2)->getTimestamp();
    }

    private function notificationPayload(object $n): array
    {
        return [
            'id' => $n->id,
            'type' => $n->type,
            'title' => $n->title,
            'body' => $n->body,
            'payload' => json_decode($n->payload ?? '{}', true) ?: [],
            'read_at' => $this->iso($n->read_at),
            'created_at' => $this->iso($n->created_at),
        ];
    }

    private function messagePayload(object $m): array
    {
        return [
            'id' => $m->id,
            'conversation_id' => $m->conversation_id,
            'sender_user_id' => $m->sender_user_id,
            'body' => $m->body,
            'attachment_url' => $m->attachment_url ?? null,
            'attachment_type' => $m->attachment_type ?? null,
            'created_at' => $this->iso($m->created_at),
        ];
    }

    private function groupConversationForParticipant(string $id, string $userId): object
    {
        $conversation = DB::table('conversations')->where('id', $id)->where('kind', 'group')->first();
        if ($conversation === null) {
            throw ApiException::notFound('Group conversation not found');
        }
        $participant = DB::table('conversation_participants')->where('conversation_id', $id)->where('user_id', $userId)->whereNull('left_at')->exists();
        if (! $participant) {
            throw ApiException::forbidden('Conversation not available');
        }

        return $conversation;
    }

    private function conversationOwnerId(object $conversation): ?string
    {
        if ($conversation->game_id !== null) {
            return DB::table('games')->where('id', $conversation->game_id)->value('host_user_id');
        }
        if ($conversation->tournament_id !== null) {
            return DB::table('tournament_entries')->where('tournament_id', $conversation->tournament_id)->orderBy('created_at')->value('captain_user_id');
        }

        return null;
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
