<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class VenueReviewsController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function store(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'body' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
        ]);
        if (! DB::table('venues')->where('id', $id)->exists()) {
            throw ApiException::notFound('Venue not found');
        }
        if (! $this->hasQualifyingBooking($id, (string) $user->id)) {
            throw ApiException::forbidden('You can review a venue only after a booking there');
        }

        $existing = DB::table('venue_reviews')
            ->where('venue_id', $id)
            ->where('author_user_id', $user->id)
            ->first(['id']);
        if ($existing !== null) {
            DB::table('venue_reviews')->where('id', $existing->id)->update([
                'rating' => $data['rating'],
                'body' => $data['body'] ?? null,
                'photo_url' => $data['photo_url'] ?? null,
                'removed_at' => null,
                'updated_at' => now(),
            ]);
        } else {
            DB::table('venue_reviews')->insert([
                'id' => (string) Str::uuid(),
                'venue_id' => $id,
                'author_user_id' => $user->id,
                'rating' => $data['rating'],
                'body' => $data['body'] ?? null,
                'photo_url' => $data['photo_url'] ?? null,
                'removed_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $this->refreshVenueRating($id);

        return response()->json($this->latestReview($id, $user->id), 201);
    }

    public function index(Request $request, string $id): JsonResponse
    {
        $limit = min(max((int) $request->query('limit', 20), 1), 50);
        $sort = $request->query('sort', 'recent');
        $q = DB::table('venue_reviews as r')
            ->join('users as u', 'u.id', '=', 'r.author_user_id')
            ->where('r.venue_id', $id)
            ->whereNull('r.removed_at');
        $sort === 'highest' ? $q->orderByDesc('r.rating')->orderByDesc('r.created_at') : $q->orderByDesc('r.created_at');

        $rows = $q->limit($limit + 1)->get([
            'r.id',
            'r.venue_id',
            'r.author_user_id',
            'r.rating',
            'r.body',
            'r.photo_url as review_photo_url',
            'r.created_at',
            'r.updated_at',
            'u.display_name',
            'u.photo_url as author_photo_url',
        ]);

        return response()->json([
            'items' => $rows->take($limit)->map(fn ($r) => $this->reviewPayload($r))->values(),
            'next_cursor' => $rows->count() > $limit ? base64_encode((string) $rows[$limit - 1]->id) : null,
        ]);
    }

    public function summary(string $id): JsonResponse
    {
        $hist = ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 0];
        foreach (DB::table('venue_reviews')->where('venue_id', $id)->whereNull('removed_at')->selectRaw('rating, count(*) as total')->groupBy('rating')->get() as $r) {
            $hist[(string) $r->rating] = (int) $r->total;
        }
        $summary = DB::table('venue_reviews')
            ->where('venue_id', $id)
            ->whereNull('removed_at')
            ->selectRaw('round(avg(rating)::numeric, 2) as avg_rating, count(*) as review_count')
            ->first();

        return response()->json([
            'venue_id' => $id,
            'avg_rating' => $summary?->avg_rating !== null ? (float) $summary->avg_rating : null,
            'review_count' => (int) ($summary->review_count ?? 0),
            'histogram' => $hist,
        ]);
    }

    public function partnerIndex(Request $request): JsonResponse
    {
        $venueId = $this->requirePartnerPermission($request, 'reviews');

        return response()->json($this->reviewListPayload($request, $venueId));
    }

    public function partnerRemove(Request $request, string $id): JsonResponse
    {
        $venueId = $this->requirePartnerPermission($request, 'reviews');
        $review = $this->reviewForVenue($id, $venueId);

        return $this->setRemoved($request, $review, true, 'partner.review.remove');
    }

    public function partnerRestore(Request $request, string $id): JsonResponse
    {
        $venueId = $this->requirePartnerPermission($request, 'reviews');
        $review = $this->reviewForVenue($id, $venueId, true);

        return $this->setRemoved($request, $review, false, 'partner.review.restore');
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'reviews');
        $venueId = $request->query('venue_id');

        return response()->json($this->reviewListPayload($request, is_string($venueId) && $venueId !== '' ? $venueId : null, true));
    }

    public function adminShow(Request $request, string $id): JsonResponse
    {
        $this->requireAdminPermission($request, 'reviews');
        $review = $this->reviewById($id, true);

        return response()->json([
            ...$this->reviewPayload($review),
            'audit' => DB::table('audit_log as a')
                ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
                ->where('a.entity', 'venue_reviews')
                ->where('a.entity_id', $id)
                ->orderByDesc('a.created_at')
                ->limit(20)
                ->get(['a.*', 'u.display_name as actor_display_name', 'u.email as actor_email'])
                ->map(fn ($event) => [
                    'id' => (string) $event->id,
                    'actor_user_id' => $event->actor_user_id ? (string) $event->actor_user_id : null,
                    'actor_display_name' => $event->actor_display_name,
                    'actor_email' => $event->actor_email,
                    'action' => $event->action,
                    'metadata' => json_decode((string) $event->metadata, true) ?: [],
                    'created_at' => $this->iso($event->created_at),
                ]),
        ]);
    }

    public function adminRemove(Request $request, string $id): JsonResponse
    {
        $this->requireAdminPermission($request, 'reviews');
        $review = $this->reviewById($id, true);

        return $this->setRemoved($request, $review, true, 'admin.review.remove');
    }

    public function adminRestore(Request $request, string $id): JsonResponse
    {
        $this->requireAdminPermission($request, 'reviews');
        $review = $this->reviewById($id, true);

        return $this->setRemoved($request, $review, false, 'admin.review.restore');
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $review = DB::table('venue_reviews')->where('id', $id)->first();
        if ($review === null) {
            throw ApiException::notFound('Review not found');
        }
        if ($review->author_user_id !== $user->id) {
            $this->requireAdminPermission($request, 'reviews');
        }
        DB::table('venue_reviews')->where('id', $id)->update(['removed_at' => now(), 'updated_at' => now()]);
        $this->refreshVenueRating($review->venue_id);

        return response()->json(null, 204);
    }

    /**
     * Review eligibility gate: a user may only review a venue they have actually
     * used. A booking qualifies when it is the user's own booking against a court
     * that belongs to this venue (join path: bookings.court_id → courts.venue_id)
     * AND it is either already paid (`status = paid`) OR a non-cancelled booking
     * whose slot has already started (`starts_at < now`). Cancelled / refunded /
     * failed bookings never qualify, so a user who only ever cancelled cannot
     * review-bomb the venue.
     */
    private function hasQualifyingBooking(string $venueId, string $userId): bool
    {
        return DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->where('c.venue_id', $venueId)
            ->where('b.user_id', $userId)
            ->where(function ($q) {
                $q->where('b.status', 'paid')
                    ->orWhere(function ($qq) {
                        $qq->whereNotIn('b.status', ['cancelled', 'refunded', 'failed'])
                            ->where('b.starts_at', '<', now());
                    });
            })
            ->exists();
    }

    private function latestReview(string $venueId, string $userId): array
    {
        $row = DB::table('venue_reviews as r')
            ->join('users as u', 'u.id', '=', 'r.author_user_id')
            ->join('venues as v', 'v.id', '=', 'r.venue_id')
            ->where('r.venue_id', $venueId)
            ->where('r.author_user_id', $userId)
            ->first([
                'r.id',
                'r.venue_id',
                'r.author_user_id',
                'r.rating',
                'r.body',
                'r.photo_url as review_photo_url',
                'r.created_at',
                'r.updated_at',
                'r.removed_at',
                'v.name as venue_name',
                'u.display_name',
                'u.email as author_email',
                'u.photo_url as author_photo_url',
            ]);

        return $this->reviewPayload($row);
    }

    private function reviewPayload(object $r): array
    {
        return [
            'id' => $r->id,
            'venue_id' => $r->venue_id,
            'venue_name' => $r->venue_name ?? null,
            // Flat author fields consumed by the web client.
            'author_user_id' => $r->author_user_id,
            'display_name' => $r->display_name,
            'author_photo_url' => $r->author_photo_url,
            // Nested author retained for existing (iOS / admin) consumers.
            'author' => [
                'id' => $r->author_user_id,
                'display_name' => $r->display_name,
                'email' => $r->author_email ?? null,
                'photo_url' => $r->author_photo_url,
            ],
            'rating' => (int) $r->rating,
            'body' => $r->body,
            // Web reads `review_photo_url`; `photo_url` retained for compatibility.
            'photo_url' => $r->review_photo_url,
            'review_photo_url' => $r->review_photo_url,
            'created_at' => $this->iso($r->created_at),
            'updated_at' => $this->iso($r->updated_at),
            'removed_at' => $this->iso($r->removed_at ?? null),
        ];
    }

    private function reviewListPayload(Request $request, ?string $venueId = null, bool $admin = false): array
    {
        $limit = min(max((int) $request->query('limit', 25), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $includeRemoved = $admin && filter_var($request->query('include_removed', false), FILTER_VALIDATE_BOOLEAN);
        $rating = $request->query('rating');
        $term = trim((string) $request->query('q', ''));

        $base = $this->reviewsBaseQuery()
            ->when($venueId, fn ($q) => $q->where('r.venue_id', $venueId))
            ->when($rating !== null && $rating !== '', fn ($q) => $q->where('r.rating', (int) $rating))
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(function ($qq) use ($like) {
                    $qq->where('r.body', 'ilike', $like)
                        ->orWhere('u.display_name', 'ilike', $like)
                        ->orWhere('u.email', 'ilike', $like)
                        ->orWhere('v.name', 'ilike', $like);
                });
            });
        $query = (clone $base)->when(! $includeRemoved, fn ($q) => $q->whereNull('r.removed_at'));
        $total = (clone $query)->count('r.id');

        return [
            'items' => $query
                ->orderByDesc('r.created_at')
                ->offset($offset)
                ->limit($limit)
                ->get()
                ->map(fn ($review) => $this->reviewPayload($review))
                ->values(),
            'total' => $total,
            'summary' => [
                'avg_rating' => (clone $base)->whereNull('r.removed_at')->avg('r.rating'),
                'active_count' => (clone $base)->whereNull('r.removed_at')->count('r.id'),
                'removed_count' => (clone $base)->whereNotNull('r.removed_at')->count('r.id'),
            ],
        ];
    }

    private function reviewsBaseQuery()
    {
        return DB::table('venue_reviews as r')
            ->join('users as u', 'u.id', '=', 'r.author_user_id')
            ->join('venues as v', 'v.id', '=', 'r.venue_id')
            ->select([
                'r.id',
                'r.venue_id',
                'v.name as venue_name',
                'r.author_user_id',
                'r.rating',
                'r.body',
                'r.photo_url as review_photo_url',
                'r.created_at',
                'r.updated_at',
                'r.removed_at',
                'u.display_name',
                'u.email as author_email',
                'u.photo_url as author_photo_url',
            ]);
    }

    private function reviewById(string $id, bool $includeRemoved = false): object
    {
        $query = $this->reviewsBaseQuery()->where('r.id', $id);
        if (! $includeRemoved) {
            $query->whereNull('r.removed_at');
        }
        $review = $query->first();
        if ($review === null) {
            throw ApiException::notFound('Review not found');
        }

        return $review;
    }

    private function reviewForVenue(string $id, string $venueId, bool $includeRemoved = false): object
    {
        $query = $this->reviewsBaseQuery()->where('r.id', $id)->where('r.venue_id', $venueId);
        if (! $includeRemoved) {
            $query->whereNull('r.removed_at');
        }
        $review = $query->first();
        if ($review === null) {
            throw ApiException::notFound('Review not found');
        }

        return $review;
    }

    private function setRemoved(Request $request, object $review, bool $removed, string $action): JsonResponse
    {
        DB::table('venue_reviews')->where('id', $review->id)->update([
            'removed_at' => $removed ? now() : null,
            'updated_at' => now(),
        ]);
        $this->refreshVenueRating($review->venue_id);
        $this->auditWrite($this->authUser($request)->id, $action, $review->id, [
            'venue_id' => $review->venue_id,
            'author_user_id' => $review->author_user_id,
        ]);

        return response()->json($this->reviewPayload($this->reviewById($review->id, true)));
    }

    private function partnerVenueId(Request $request): string
    {
        $user = $this->authUser($request);
        if ($user->admin_role !== 'partner' || $user->venue_id === null) {
            throw ApiException::forbidden('Owner access required');
        }

        return (string) $user->venue_id;
    }

    private function requirePartnerPermission(Request $request, string $permission): string
    {
        $venueId = $this->partnerVenueId($request);
        $user = $this->authUser($request);
        if (DB::table('venues')->where('id', $venueId)->where('owner_user_id', $user->id)->exists()) {
            return $venueId;
        }
        $permissions = $this->normalizePartnerPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null);
        if (! (bool) ($permissions[$permission] ?? false)) {
            throw ApiException::forbidden('Owner permission required: '.$permission);
        }

        return $venueId;
    }

    private function normalizePartnerPermissions(?array $permissions): array
    {
        $base = [
            'dashboard' => true,
            'bookings' => true,
            'manual_booking' => true,
            'calendar' => true,
            'courts' => true,
            'maintenance' => true,
            'customers' => true,
            'reviews' => true,
            'reports' => true,
            'tournaments' => true,
            'staff' => false,
            'venue_settings' => false,
            'revenue' => false,
        ];
        if ($permissions === null) {
            return $base;
        }
        foreach ($base as $key => $default) {
            if (array_key_exists($key, $permissions)) {
                $base[$key] = (bool) $permissions[$key];
            }
        }

        return $base;
    }

    private function auditWrite(string $actorUserId, string $action, string $entityId, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => 'venue_reviews',
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }

    private function refreshVenueRating(string $venueId): void
    {
        // The Postgres `::numeric` cast (used to make round() deterministic) is
        // not portable; sqlite (used by the test suite) rejects it. Compute the
        // average in PHP from the raw rows so this works on every driver while
        // preserving the 2-decimal rounding Postgres produced.
        $stats = DB::table('venue_reviews')
            ->where('venue_id', $venueId)
            ->whereNull('removed_at')
            ->selectRaw('avg(rating) as avg_rating, count(*) as review_count')
            ->first();
        $count = (int) ($stats->review_count ?? 0);
        DB::table('venues')->where('id', $venueId)->update([
            'rating_avg' => $count > 0 && $stats->avg_rating !== null ? round((float) $stats->avg_rating, 2) : null,
            'rating_count' => $count,
            'updated_at' => now(),
        ]);
    }
}
