<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MessagingController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function notifications(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $rows = DB::table('notifications')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(100)
            ->get();

        return response()->json([
            'items' => $rows->map(fn ($n) => $this->notificationPayload($n)),
            'unread_count' => DB::table('notifications')->where('user_id', $user->id)->whereNull('read_at')->count(),
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
        $rows = DB::table('conversation_participants as me')
            ->join('conversations as c', 'c.id', '=', 'me.conversation_id')
            ->join('conversation_participants as other_cp', function ($join) {
                $join->on('other_cp.conversation_id', '=', 'c.id')
                    ->whereColumn('other_cp.user_id', '!=', 'me.user_id');
            })
            ->join('users as other', 'other.id', '=', 'other_cp.user_id')
            ->where('me.user_id', $user->id)
            ->whereNull('me.left_at')
            ->orderByDesc('c.last_message_at')
            ->orderByDesc('c.created_at')
            ->get([
                'c.id',
                'other.id as other_user_id',
                'other.display_name as other_display_name',
                'other.photo_url as other_photo_url',
                'c.last_message_at',
                'me.last_read_at',
            ]);

        return response()->json([
            'items' => $rows->map(function ($r) {
                $last = DB::table('messages')->where('conversation_id', $r->id)->orderByDesc('created_at')->first();

                return [
                    'id' => $r->id,
                    'other_user_id' => $r->other_user_id,
                    'other_display_name' => $r->other_display_name,
                    'other_photo_url' => $r->other_photo_url,
                    'last_message_body' => $last->body ?? null,
                    'last_message_at' => $this->iso($r->last_message_at),
                    'unread' => $last !== null && ($r->last_read_at === null || $last->created_at > $r->last_read_at),
                ];
            }),
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

        $existing = DB::table('conversation_participants as a')
            ->join('conversation_participants as b', 'b.conversation_id', '=', 'a.conversation_id')
            ->where('a.user_id', $user->id)
            ->where('b.user_id', $data['other_user_id'])
            ->value('a.conversation_id');
        if ($existing !== null) {
            DB::table('conversation_participants')->where('conversation_id', $existing)->whereIn('user_id', [$user->id, $data['other_user_id']])->update(['left_at' => null]);

            return response()->json(['conversation_id' => $existing]);
        }

        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $user, $data) {
            DB::table('conversations')->insert(['id' => $id, 'created_at' => now()]);
            DB::table('conversation_participants')->insert([
                ['conversation_id' => $id, 'user_id' => $user->id],
                ['conversation_id' => $id, 'user_id' => $data['other_user_id']],
            ]);
        });

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

        $messages = DB::table('messages')
            ->where('conversation_id', $id)
            ->orderBy('created_at')
            ->limit(500)
            ->get()
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
                'other_last_read_at' => null,
                'messages' => $messages,
            ]);
        }

        // 1:1 direct conversation — original behaviour, unchanged.
        $other = DB::table('conversation_participants as cp')
            ->join('users as u', 'u.id', '=', 'cp.user_id')
            ->where('cp.conversation_id', $id)
            ->where('cp.user_id', '!=', $user->id)
            ->first(['u.id', 'u.display_name', 'u.photo_url', 'cp.last_read_at']);
        if ($other === null) {
            throw ApiException::notFound('Conversation not found');
        }

        return response()->json([
            'conversation_id' => $id,
            'other_user_id' => $other->id,
            'other_display_name' => $other->display_name,
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

        return response()->json(null, 204);
    }

    public function leave(Request $request, string $id): JsonResponse
    {
        DB::table('conversation_participants')
            ->where('conversation_id', $id)
            ->where('user_id', $this->authUser($request)->id)
            ->whereNull('left_at')
            ->update(['left_at' => now()]);

        return response()->json(null, 204);
    }

    public function sendMessage(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if (! DB::table('conversation_participants')->where('conversation_id', $id)->where('user_id', $user->id)->whereNull('left_at')->exists()) {
            throw ApiException::forbidden('Conversation not available');
        }
        $data = $this->validateBody($request, [
            'body' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'attachment_url' => ['sometimes', 'nullable', 'string', 'max:2048'],
            'attachment_type' => ['sometimes', 'nullable', 'in:image,voice'],
        ]);
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

        return response()->json($this->messagePayload($row), 201);
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
        $this->authUser($request);

        return response()->json(null, 204);
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
