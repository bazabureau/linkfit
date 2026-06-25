<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SupportController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function mine(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'in:open,pending,resolved,closed'],
        ]);
        $base = DB::table('support_tickets')->where('user_id', $user->id);
        if (! empty($query['status'])) {
            $base->where('status', $query['status']);
        }
        $total = (clone $base)->count();
        $limit = (int) ($query['limit'] ?? 30);
        $offset = (int) ($query['offset'] ?? 0);

        return response()->json([
            'items' => $base->orderByDesc('created_at')->offset($offset)->limit($limit)->get()->map(fn ($ticket) => $this->ticketPayload($ticket))->values(),
            'pagination' => ['limit' => $limit, 'offset' => $offset, 'total' => $total],
        ]);
    }

    public function create(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'category' => ['sometimes', 'in:general,booking,payment,venue,account,bug,owner'],
            'subject' => ['required', 'string', 'min:2', 'max:160'],
            'message' => ['required', 'string', 'min:2', 'max:4000'],
            'priority' => ['sometimes', 'in:low,normal,high,urgent'],
            'related_kind' => ['sometimes', 'nullable', 'in:booking,game,tournament,venue,court,payment'],
            'related_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $id = (string) Str::uuid();
        DB::table('support_tickets')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'category' => $data['category'] ?? 'general',
            'subject' => $data['subject'],
            'message' => $data['message'],
            'status' => 'open',
            'priority' => $data['priority'] ?? 'normal',
            'related_kind' => $data['related_kind'] ?? null,
            'related_id' => $data['related_id'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json($this->ticketPayload($this->ticketRow($id), true), 201);
    }

    public function publicCreate(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:254'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'category' => ['sometimes', 'in:general,booking,payment,venue,account,bug,owner'],
            'subject' => ['required', 'string', 'min:2', 'max:160'],
            'message' => ['required', 'string', 'min:2', 'max:4000'],
        ]);

        $contact = [
            'Ad: '.trim($data['name']),
            'E-poct: '.mb_strtolower(trim($data['email'])),
        ];
        if (! empty($data['phone'])) {
            $contact[] = 'Telefon: '.trim($data['phone']);
        }

        $id = (string) Str::uuid();
        DB::table('support_tickets')->insert([
            'id' => $id,
            'user_id' => null,
            'category' => $data['category'] ?? 'general',
            'subject' => $data['subject'],
            'message' => implode("\n", $contact)."\n\n".$data['message'],
            'status' => 'open',
            'priority' => 'normal',
            'related_kind' => null,
            'related_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json($this->ticketPayload($this->ticketRow($id)), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $ticket = $this->ticketRow($id);
        $user = $this->authUser($request);
        if ($ticket->user_id !== $user->id) {
            $this->requireAdminPermission($request, 'operations');
        }

        return response()->json($this->ticketPayload($ticket, true));
    }

    public function addMessage(Request $request, string $id): JsonResponse
    {
        $ticket = $this->ticketRow($id);
        $user = $this->authUser($request);
        if ($ticket->user_id !== $user->id) {
            $this->requireAdminPermission($request, 'operations');
        }
        $data = $this->validateBody($request, [
            'body' => ['required', 'string', 'min:1', 'max:4000'],
        ]);
        $messageId = (string) Str::uuid();
        DB::transaction(function () use ($id, $messageId, $user, $ticket, $data): void {
            DB::table('support_ticket_messages')->insert([
                'id' => $messageId,
                'ticket_id' => $id,
                'author_user_id' => $user->id,
                'author_role' => $this->isStaff($user) ? 'staff' : 'user',
                'body' => $data['body'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('support_tickets')->where('id', $id)->update([
                'status' => $this->isStaff($user) ? 'pending' : 'open',
                'updated_at' => now(),
            ]);
            if ($this->isStaff($user)) {
                $this->auditWrite($user->id, 'support.message', $id, [
                    'ticket_user_id' => $ticket->user_id,
                    'message_id' => $messageId,
                ]);
            }
        });

        return response()->json($this->ticketPayload($this->ticketRow($id), true), 201);
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $ticket = $this->ticketRow($id);
        $user = $this->authUser($request);
        if ($ticket->user_id !== $user->id) {
            $this->requireAdminPermission($request, 'operations');
        }
        DB::transaction(function () use ($id, $user, $ticket): void {
            DB::table('support_tickets')->where('id', $id)->update([
                'status' => 'closed',
                'resolved_at' => now(),
                'updated_at' => now(),
            ]);
            if ($this->isStaff($user)) {
                $this->auditWrite($user->id, 'support.close', $id, [
                    'ticket_user_id' => $ticket->user_id,
                ]);
            }
        });

        return response()->json($this->ticketPayload($this->ticketRow($id), true));
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'operations');
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'in:open,pending,resolved,closed'],
            'priority' => ['nullable', 'in:low,normal,high,urgent'],
            'category' => ['nullable', 'in:general,booking,payment,venue,account,bug,owner'],
            'q' => ['nullable', 'string', 'max:120'],
        ]);
        $base = DB::table('support_tickets as t')->leftJoin('users as u', 'u.id', '=', 't.user_id');
        foreach (['status', 'priority', 'category'] as $field) {
            if (! empty($query[$field])) {
                $base->where('t.'.$field, $query[$field]);
            }
        }
        if (! empty($query['q'])) {
            $needle = '%'.addcslashes(mb_strtolower($query['q']), '%_\\').'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(t.subject) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(t.message) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(u.email, \'\')) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(u.display_name, \'\')) LIKE ?', [$needle]);
            });
        }
        $total = (clone $base)->count('t.id');
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);

        return response()->json([
            'items' => $base->orderByDesc('t.created_at')->offset($offset)->limit($limit)->get(['t.*'])->map(fn ($ticket) => $this->ticketPayload($ticket))->values(),
            'pagination' => ['limit' => $limit, 'offset' => $offset, 'total' => $total],
            'summary' => [
                'open' => DB::table('support_tickets')->where('status', 'open')->count(),
                'pending' => DB::table('support_tickets')->where('status', 'pending')->count(),
                'urgent' => DB::table('support_tickets')->where('priority', 'urgent')->whereIn('status', ['open', 'pending'])->count(),
            ],
        ]);
    }

    public function adminUpdate(Request $request, string $id): JsonResponse
    {
        $staff = $this->requireAdminPermission($request, 'operations');
        $ticket = $this->ticketRow($id);
        $data = $this->validateBody($request, [
            'status' => ['sometimes', 'required', 'in:open,pending,resolved,closed'],
            'priority' => ['sometimes', 'required', 'in:low,normal,high,urgent'],
            'assigned_to_user_id' => ['sometimes', 'nullable', 'uuid'],
            'resolution_note' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ]);
        if ($data === []) {
            return response()->json($this->ticketPayload($this->ticketRow($id), true));
        }
        $updates = [...$data, 'updated_at' => now()];
        if (($data['status'] ?? null) === 'resolved' || ($data['status'] ?? null) === 'closed') {
            $updates['resolved_at'] = now();
        }
        if (array_key_exists('assigned_to_user_id', $data) && $data['assigned_to_user_id'] === null) {
            $updates['assigned_to_user_id'] = null;
        } elseif (! array_key_exists('assigned_to_user_id', $data)) {
            $updates['assigned_to_user_id'] = $staff->id;
        }
        DB::transaction(function () use ($id, $updates, $staff, $ticket, $data): void {
            DB::table('support_tickets')->where('id', $id)->update($updates);
            $this->auditWrite($staff->id, 'support.update', $id, [
                'ticket_user_id' => $ticket->user_id,
                'fields' => array_keys($data),
                'status' => $data['status'] ?? null,
                'priority' => $data['priority'] ?? null,
            ]);
        });

        return response()->json($this->ticketPayload($this->ticketRow($id), true));
    }

    private function ticketRow(string $id): object
    {
        $ticket = DB::table('support_tickets')->where('id', $id)->first();
        if (! $ticket) {
            throw ApiException::notFound('Support ticket not found');
        }

        return $ticket;
    }

    private function ticketPayload(object $ticket, bool $includeMessages = false): array
    {
        $payload = [
            'id' => $ticket->id,
            'user_id' => $ticket->user_id,
            'user' => $this->userSummary($ticket->user_id),
            'category' => $ticket->category,
            'subject' => $ticket->subject,
            'message' => $ticket->message,
            'status' => $ticket->status,
            'priority' => $ticket->priority,
            'related_kind' => $ticket->related_kind,
            'related_id' => $ticket->related_id,
            'assigned_to_user_id' => $ticket->assigned_to_user_id,
            'assigned_to' => $ticket->assigned_to_user_id ? $this->userSummary($ticket->assigned_to_user_id) : null,
            'resolution_note' => $ticket->resolution_note,
            'resolved_at' => $this->iso($ticket->resolved_at),
            'created_at' => $this->iso($ticket->created_at),
            'updated_at' => $this->iso($ticket->updated_at),
            'messages_count' => DB::table('support_ticket_messages')->where('ticket_id', $ticket->id)->count(),
        ];
        if ($includeMessages) {
            $payload['messages'] = DB::table('support_ticket_messages')
                ->where('ticket_id', $ticket->id)
                ->orderBy('created_at')
                ->get()
                ->map(fn ($message) => [
                    'id' => $message->id,
                    'author_user_id' => $message->author_user_id,
                    'author' => $this->userSummary($message->author_user_id),
                    'author_role' => $message->author_role,
                    'body' => $message->body,
                    'created_at' => $this->iso($message->created_at),
                ])
                ->values();
        }

        return $payload;
    }

    /** @var array<string,array<string,mixed>|null> per-request memo so list payloads don't re-query the same user id */
    private array $userSummaryCache = [];

    private function userSummary(?string $id): ?array
    {
        if (! $id) {
            return null;
        }
        if (array_key_exists($id, $this->userSummaryCache)) {
            return $this->userSummaryCache[$id];
        }
        $user = DB::table('users')->where('id', $id)->first(['id', 'email', 'display_name', 'photo_url', 'admin_role']);
        if (! $user) {
            return $this->userSummaryCache[$id] = null;
        }

        return $this->userSummaryCache[$id] = [
            'id' => $user->id,
            'email' => $user->email,
            'display_name' => $user->display_name,
            'photo_url' => $user->photo_url,
            'admin_role' => $user->admin_role,
        ];
    }

    private function auditWrite(?string $actorUserId, string $action, string $entityId, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => 'support_tickets',
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }

    private function isStaff(object $user): bool
    {
        return in_array($user->admin_role, ['admin', 'moderator'], true);
    }
}
