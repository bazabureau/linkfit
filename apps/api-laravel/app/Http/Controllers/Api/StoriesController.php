<?php

namespace App\Http\Controllers\Api;

use App\Events\ConversationUpdated;
use App\Events\MessageSent;
use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Http\Controllers\Api\Concerns\HidesModeratedContent;
use App\Http\Controllers\Api\Concerns\ResolvesDirectConversations;
use App\Http\Controllers\Api\Concerns\ValidatesMediaUrls;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class StoriesController extends ApiController
{
    use FiltersBlockedUsers;
    use HidesModeratedContent;
    use ResolvesDirectConversations;
    use ValidatesMediaUrls;

    private array $emojiKeys = ['heart', 'fire', '100', 'clap', 'padel'];

    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            // PREFERRED: a server-owned media_asset_id (resolved to a trusted URL
            // below). Free-form media_url is still accepted for backward
            // compatibility but is constrained to https + an allowlisted host so
            // arbitrary off-domain URLs can't be stored and served to viewers.
            'media_asset_id' => ['sometimes', 'nullable', 'uuid', 'required_without:media_url'],
            'media_url' => ['sometimes', 'nullable', 'string', 'max:2048', 'required_without:media_asset_id'],
            'media_type' => ['required', 'in:image,video'],
            'caption' => ['sometimes', 'nullable', 'string', 'max:500'],
            'overlays' => ['sometimes', 'array', 'max:32'],
            'mentions' => ['sometimes', 'array', 'max:16'],
            'mentions.*.user_id' => ['required_with:mentions', 'uuid'],
            'mentions.*.x' => ['required_with:mentions', 'numeric', 'min:0', 'max:1'],
            'mentions.*.y' => ['required_with:mentions', 'numeric', 'min:0', 'max:1'],
        ]);
        // Derive the stored media URL: from the owned asset when given, otherwise
        // from the allowlist-validated free URL.
        $data['media_url'] = ! empty($data['media_asset_id'])
            ? $this->resolveOwnedMediaAssetUrl((string) $data['media_asset_id'], (string) $user->id)
            : $this->assertAllowedMediaUrl((string) $data['media_url']);
        // Resolve which mentioned users are actually taggable: they must exist
        // (a real, non-deleted user) and must not be in a block relationship with
        // the author in EITHER direction — so a story can't tag a non-existent
        // user or someone who blocked the author. Done once up front (batched
        // existence + block checks) so the transaction below only inserts valid
        // rows; the response shape is unchanged (it reflects the stored mentions).
        $mentionUserIds = collect($data['mentions'] ?? [])
            ->pluck('user_id')
            ->filter()
            ->unique()
            ->values()
            ->all();
        $existingMentionIds = $mentionUserIds === []
            ? []
            : DB::table('users')
                ->whereIn('id', $mentionUserIds)
                ->whereNull('deleted_at')
                ->pluck('id')
                ->map(fn ($v) => (string) $v)
                ->all();
        $blockedMentionIds = [];
        foreach ($existingMentionIds as $mentionedId) {
            if ($this->blockExistsBetween((string) $user->id, $mentionedId)) {
                $blockedMentionIds[$mentionedId] = true;
            }
        }
        $taggable = array_flip(array_filter(
            $existingMentionIds,
            fn ($mentionedId) => ! isset($blockedMentionIds[$mentionedId]),
        ));

        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $user, $data, $taggable) {
            DB::table('stories')->insert([
                'id' => $id,
                'user_id' => $user->id,
                'media_url' => $data['media_url'],
                'media_type' => $data['media_type'],
                'caption' => $data['caption'] ?? null,
                'overlays' => json_encode($data['overlays'] ?? []),
                'created_at' => now(),
                'expires_at' => now()->addDay(),
            ]);
            foreach (($data['mentions'] ?? []) as $mention) {
                // Silently drop tags for non-existent or blocking users — never
                // mint a story_mentions row for them.
                if (! isset($taggable[(string) $mention['user_id']])) {
                    continue;
                }
                DB::table('story_mentions')->insertOrIgnore([
                    'story_id' => $id,
                    'mentioned_user_id' => $mention['user_id'],
                    'x' => $mention['x'],
                    'y' => $mention['y'],
                    'created_at' => now(),
                ]);
            }
        });

        $story = DB::table('stories')->where('id', $id)->first();

        return response()->json([
            'id' => $story->id,
            'user_id' => $story->user_id,
            'media_url' => $story->media_url,
            'media_type' => $story->media_type,
            'caption' => $story->caption,
            'created_at' => $this->iso($story->created_at),
            'expires_at' => $this->iso($story->expires_at),
            'view_count' => (int) $story->view_count,
            // iOS `Story` decodes `viewed_by_me` as a REQUIRED Bool. A freshly
            // created story has never been viewed (the author's own view is not
            // recorded), so it is always false here.
            'viewed_by_me' => false,
            'overlays' => json_decode($story->overlays ?? '[]', true) ?: [],
            'mentions' => $this->mentions($story->id),
        ], 201);
    }

    public function feed(Request $request): JsonResponse
    {
        $viewer = $this->authUser($request);
        // Apple Guideline 1.2: exclude stories an active moderation hide covers.
        $hiddenStoryIds = $this->activeHiddenTargetIds('story');
        $rows = DB::table('stories as s')
            ->join('users as u', 'u.id', '=', 's.user_id')
            ->where('s.expires_at', '>', now())
            ->when($hiddenStoryIds !== [], fn ($q) => $q->whereNotIn('s.id', $hiddenStoryIds))
            ->when(true, fn ($q) => $this->whereNotBlocked($q, (string) $viewer->id, 's.user_id'))
            ->orderByDesc('s.created_at')
            ->limit(200)
            ->get(['s.*', 'u.display_name', 'u.photo_url']);

        // Batch every per-story lookup over the whole feed (was ~5-6 queries per
        // story → up to ~1000 per request). Four whereIn() queries keyed by story
        // id feed storyPayload() + the has_unviewed check below.
        $storyIds = $rows->pluck('id')->all();
        $maps = $this->prefetchStoryFeedMaps($storyIds, (string) $viewer->id);
        $viewedIds = $maps['viewed'];

        $items = $rows->groupBy('user_id')->map(function ($stories) use ($viewer, $maps, $viewedIds) {
            $first = $stories->first();

            return [
                'user_id' => $first->user_id,
                'display_name' => $first->display_name,
                'photo_url' => $first->photo_url,
                'has_unviewed' => $stories->contains(fn ($s) => ! isset($viewedIds[$s->id])),
                'latest_story_at' => $this->iso($first->created_at),
                'stories' => $stories->map(fn ($s) => $this->storyPayload($s, $viewer->id, $maps))->values(),
            ];
        })->values();

        return response()->json(['items' => $items]);
    }

    public function view(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // stories.id is a uuid column; reject a malformed route value as a clean
        // 404 before Postgres surfaces it as a 22P02 (a generic 500).
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Story not found');
        }
        // A block (either direction) hides the story from the viewer, mirroring
        // the feed's bidirectional `whereNotBlocked` discovery rule — so a
        // blocked viewer can neither read it nor inflate the author's view_count.
        $story = DB::table('stories')->where('id', $id)->first(['user_id']);
        // Reject a client-supplied id that resolves to no story: otherwise the
        // block guard below is silently skipped (null story) and an orphan
        // `story_views` row is minted for an arbitrary id.
        if ($story === null) {
            throw ApiException::notFound('Story not found');
        }
        if ($this->blockExistsBetween((string) $user->id, (string) $story->user_id)) {
            throw ApiException::forbidden('Cannot view this story');
        }
        // The author's own view is never recorded (store() documents this and the
        // feed's has_unviewed/viewed_by_me rely on it): recording it would
        // inflate view_count and list the author in their own viewers. Stay a
        // no-op {ok:true} so the client contract is unchanged.
        if ((string) $user->id !== (string) $story->user_id) {
            $inserted = DB::table('story_views')->insertOrIgnore(['story_id' => $id, 'viewer_user_id' => $user->id, 'viewed_at' => now()]);
            if ($inserted) {
                DB::table('stories')->where('id', $id)->increment('view_count');
            }
        }

        return response()->json(['ok' => true]);
    }

    public function viewers(Request $request, string $id): JsonResponse
    {
        // uuid guard before the uuid stories.id column (avoids a 22P02 → 500 on a
        // malformed route value); a non-uuid id simply resolves to no story.
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Story not found');
        }
        $story = DB::table('stories')->where('id', $id)->first();
        if ($story === null) {
            throw ApiException::notFound('Story not found');
        }
        if ($story->user_id !== $this->authUser($request)->id) {
            throw ApiException::forbidden('Only author can view viewers');
        }

        // Capture the rows so we can ship `count` alongside the array — iOS
        // `StoryViewersResponse` decodes `count` as a REQUIRED Int (it drives
        // the eye-pill total without re-counting client-side). Left-join
        // `story_reactions` so each row carries the viewer's `reaction_emoji`
        // (wire key) when they also reacted; iOS reads it via
        // `decodeIfPresent`, so a null is fine when they didn't.
        $rows = DB::table('story_views as v')
            ->join('users as u', 'u.id', '=', 'v.viewer_user_id')
            ->leftJoin('story_reactions as r', function ($join) use ($id) {
                $join->on('r.user_id', '=', 'v.viewer_user_id')
                    ->where('r.story_id', '=', $id);
            })
            ->where('v.story_id', $id)
            ->orderByDesc('v.viewed_at')
            ->get(['v.viewer_user_id', 'u.display_name', 'u.photo_url', 'v.viewed_at', 'r.emoji as reaction_emoji']);

        $viewers = $rows->map(fn ($v) => [
            'user_id' => $v->viewer_user_id,
            'display_name' => $v->display_name,
            // iOS `StoryViewerInfo` decodes `avatar_url` (optional). Emit it
            // so the row's avatar renders; keep `photo_url` too since other
            // callers/clients use that key.
            'avatar_url' => $v->photo_url,
            'photo_url' => $v->photo_url,
            'viewed_at' => $this->iso($v->viewed_at),
            'reaction_emoji' => $v->reaction_emoji,
        ]);

        return response()->json([
            'story_id' => $id,
            'viewers' => $viewers,
            'count' => $rows->count(),
        ]);
    }

    public function react(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // uuid guard before the uuid stories.id column (avoids a 22P02 → 500).
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Story not found');
        }
        $data = $this->validateBody($request, ['emoji' => ['required', 'in:heart,fire,100,clap,padel']]);
        $story = DB::table('stories')->where('id', $id)->first(['user_id']);
        // Reject a client-supplied id that resolves to no story: otherwise the
        // block guard below is silently skipped (null story) and an orphan
        // `story_reactions` row is minted for an arbitrary id.
        if ($story === null) {
            throw ApiException::notFound('Story not found');
        }
        if ($this->blockExistsBetween((string) $user->id, (string) $story->user_id)) {
            throw ApiException::forbidden('Cannot react to this story');
        }
        DB::table('story_reactions')->updateOrInsert(
            ['story_id' => $id, 'user_id' => $user->id],
            ['emoji' => $data['emoji'], 'created_at' => now()],
        );

        return response()->json(['reactions' => $this->reactionCounts($id), 'my_reaction' => $data['emoji']]);
    }

    public function unreact(Request $request, string $id): JsonResponse
    {
        DB::table('story_reactions')->where('story_id', $id)->where('user_id', $this->authUser($request)->id)->delete();

        return response()->json(['reactions' => $this->reactionCounts($id), 'my_reaction' => null]);
    }

    public function reply(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // uuid guard before the uuid stories.id column (avoids a 22P02 → 500).
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Story not found');
        }
        $data = $this->validateBody($request, [
            'body' => ['required', 'string', 'max:500'],
        ]);
        $body = trim($data['body']);
        if ($body === '') {
            throw ApiException::validation('Reply body cannot be empty');
        }

        // Story must still exist (the sweeper deletes expired rows). iOS
        // surfaces a 404 for expired/never-existed stories.
        $story = DB::table('stories')->where('id', $id)->first();
        if ($story === null) {
            throw ApiException::notFound('Story not found');
        }
        // Replying to your own story is a no-op the composer hides; reject it
        // so we never mint a self-conversation.
        if ($story->user_id === $user->id) {
            throw ApiException::validation('Cannot reply to your own story');
        }
        // Bidirectional block (mirrors MessagingController::startConversation): a
        // reply opens/resurrects a 1:1 DM, so neither a replier the author blocked
        // NOR a user who blocked the author may use it as a contact channel.
        if ($this->blockExistsBetween((string) $user->id, (string) $story->user_id)) {
            throw ApiException::forbidden('Cannot reply to this story');
        }

        $messageId = (string) Str::uuid();
        // Prefix so the recipient's inbox renders it as a story reply without
        // a schema migration (matches the iOS `StoryReplyRequest` contract).
        $messageBody = '↩ Story reply: '.$body;

        // Resolve-or-create the 1:1 DM thread INSIDE the transaction via the
        // shared race-safe helper (per-pair advisory lock + in-transaction
        // recheck), so a story reply can't split DM history by minting a
        // duplicate thread when it races a concurrent startConversation/reply.
        $conversationId = null;
        DB::transaction(function () use (&$conversationId, $user, $story, $messageId, $messageBody) {
            $conversationId = $this->getOrCreateDirectConversation((string) $user->id, (string) $story->user_id);

            DB::table('messages')->insert([
                'id' => $messageId,
                'conversation_id' => $conversationId,
                'sender_user_id' => $user->id,
                'body' => $messageBody,
                'attachment_url' => in_array($story->media_type, ['image', 'video'], true) ? $story->media_url : null,
                'attachment_type' => in_array($story->media_type, ['image', 'video'], true) ? $story->media_type : null,
                'created_at' => now(),
            ]);
        });
        $row = DB::table('messages')->where('id', $messageId)->first();
        if ($row !== null && $this->broadcastingEnabled()) {
            try {
                broadcast(new MessageSent((string) $conversationId, $this->messagePayload($row)))->toOthers();
                broadcast(new ConversationUpdated((string) $conversationId, $this->activeParticipantIds((string) $conversationId), 'story_reply'));
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return response()->json([
            'conversation_id' => $conversationId,
            'message_id' => $messageId,
        ], 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        // uuid guard before the uuid stories.id column (avoids a 22P02 → 500).
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Story not found');
        }
        $story = DB::table('stories')->where('id', $id)->first();
        if ($story === null) {
            throw ApiException::notFound('Story not found');
        }
        if ($story->user_id !== $this->authUser($request)->id) {
            throw ApiException::forbidden('Only author can delete story');
        }
        DB::table('stories')->where('id', $id)->delete();

        return response()->json(null, 204);
    }

    /**
     * Batch the four per-story relations the feed needs across a page of story
     * ids, so storyPayload() reads from in-memory maps instead of issuing
     * ~5-6 queries per story. Mirrors the prefetch batching in
     * FeedController::index / GamesController::index.
     *
     * @param  array<int,string>  $storyIds
     * @return array{viewed:array<string,bool>,myReactions:array<string,string>,reactionCounts:array<string,array<string,int>>,mentions:array<string,array<int,array<string,mixed>>>}
     */
    private function prefetchStoryFeedMaps(array $storyIds, string $viewerId): array
    {
        if ($storyIds === []) {
            return ['viewed' => [], 'myReactions' => [], 'reactionCounts' => [], 'mentions' => []];
        }

        $viewed = DB::table('story_views')
            ->whereIn('story_id', $storyIds)
            ->where('viewer_user_id', $viewerId)
            ->pluck('story_id')
            ->mapWithKeys(fn ($id) => [$id => true])
            ->all();

        $myReactions = DB::table('story_reactions')
            ->whereIn('story_id', $storyIds)
            ->where('user_id', $viewerId)
            ->pluck('emoji', 'story_id')
            ->all();

        $reactionCounts = [];
        foreach (DB::table('story_reactions')->whereIn('story_id', $storyIds)->groupBy('story_id', 'emoji')->selectRaw('story_id, emoji, count(*) as total')->get() as $row) {
            if (! isset($reactionCounts[$row->story_id])) {
                $reactionCounts[$row->story_id] = array_fill_keys($this->emojiKeys, 0);
            }
            $reactionCounts[$row->story_id][$row->emoji] = (int) $row->total;
        }

        $mentions = [];
        foreach (DB::table('story_mentions as m')->join('users as u', 'u.id', '=', 'm.mentioned_user_id')->whereIn('m.story_id', $storyIds)->get(['m.story_id', 'm.mentioned_user_id', 'u.display_name', 'm.x', 'm.y']) as $row) {
            $mentions[$row->story_id][] = [
                'user_id' => $row->mentioned_user_id,
                'display_name' => $row->display_name,
                'x' => (float) $row->x,
                'y' => (float) $row->y,
            ];
        }

        return ['viewed' => $viewed, 'myReactions' => $myReactions, 'reactionCounts' => $reactionCounts, 'mentions' => $mentions];
    }

    /**
     * @param  array{viewed:array<string,bool>,myReactions:array<string,string>,reactionCounts:array<string,array<string,int>>,mentions:array<string,array<int,array<string,mixed>>>}|null  $maps
     */
    private function storyPayload(object $s, string $viewerId, ?array $maps = null): array
    {
        if ($maps !== null) {
            $mine = $maps['myReactions'][$s->id] ?? null;
            $viewed = isset($maps['viewed'][$s->id]);
            $reactions = $maps['reactionCounts'][$s->id] ?? array_fill_keys($this->emojiKeys, 0);
            $mentions = $maps['mentions'][$s->id] ?? [];
        } else {
            $mine = DB::table('story_reactions')->where('story_id', $s->id)->where('user_id', $viewerId)->value('emoji');
            $viewed = DB::table('story_views')->where('story_id', $s->id)->where('viewer_user_id', $viewerId)->exists();
            $reactions = $this->reactionCounts($s->id);
            $mentions = $this->mentions($s->id);
        }

        return [
            'id' => $s->id,
            'media_url' => $s->media_url,
            'media_type' => $s->media_type,
            'caption' => $s->caption,
            'created_at' => $this->iso($s->created_at),
            'viewed_by_me' => $viewed,
            'reactions' => $reactions,
            'my_reaction' => $mine,
            'overlays' => json_decode($s->overlays ?? '[]', true) ?: [],
            'mentions' => $mentions,
        ];
    }

    private function mentions(string $storyId): array
    {
        return DB::table('story_mentions as m')->join('users as u', 'u.id', '=', 'm.mentioned_user_id')->where('m.story_id', $storyId)->get(['m.mentioned_user_id', 'u.display_name', 'm.x', 'm.y'])->map(fn ($m) => [
            'user_id' => $m->mentioned_user_id,
            'display_name' => $m->display_name,
            'x' => (float) $m->x,
            'y' => (float) $m->y,
        ])->all();
    }

    private function reactionCounts(string $storyId): array
    {
        $counts = array_fill_keys($this->emojiKeys, 0);
        foreach (DB::table('story_reactions')->where('story_id', $storyId)->selectRaw('emoji, count(*) as total')->groupBy('emoji')->get() as $row) {
            $counts[$row->emoji] = (int) $row->total;
        }

        return $counts;
    }

    private function broadcastingEnabled(): bool
    {
        return ! in_array((string) config('broadcasting.default'), ['log', 'null', ''], true);
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

    /**
     * @return array<string,mixed>
     */
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
}
