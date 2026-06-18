<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * "Learn" — public browsing of coaches + lessons (classes), and the player
 * actions to book / cancel a lesson and list their own. Public routes accept an
 * optional Bearer token (to compute is_booked_by_me); book/cancel require auth.
 */
class LessonsController extends ApiController
{
    /** GET /lessons — browse upcoming scheduled lessons (filters: sport, venue_id, kind, date, level). */
    public function index(Request $request): JsonResponse
    {
        $viewerId = $this->optionalViewerId($request);
        $limit = min(max((int) $request->query('limit', 30), 1), 100);
        // Accept either `offset` or an opaque numeric `cursor` (mobile clients
        // page via `cursor`, echoing back the `next_cursor` we return below).
        $offset = max((int) ($request->query('cursor') ?? $request->query('offset', 0)), 0);

        $query = $this->baseQuery()
            ->where('l.status', 'scheduled')
            ->where('l.starts_at', '>=', now());

        if ($sport = $request->query('sport')) {
            $query->where('s.slug', $sport);
        }
        if ($venueId = $request->query('venue_id')) {
            $query->where('l.venue_id', $venueId);
        }
        if ($kind = $request->query('kind')) {
            $query->where('l.kind', $kind);
        }
        if ($date = $request->query('date')) {
            $query->whereRaw('l.starts_at::date = ?', [$date]);
        }

        $rows = $query->orderBy('l.starts_at')->offset($offset)->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $items = $rows->take($limit);

        $bookedIds = $this->bookedLessonIds($viewerId, $items->pluck('id')->all());

        $nextOffset = $hasMore ? $offset + $limit : null;

        return response()->json([
            'items' => $items->map(fn ($l) => $this->lessonPayload($l, $bookedIds))->values(),
            'next_offset' => $nextOffset,
            // Alias as a string cursor for clients that page via `next_cursor`.
            'next_cursor' => $nextOffset !== null ? (string) $nextOffset : null,
        ]);
    }

    /** GET /lessons/{id} — full lesson detail. */
    public function show(Request $request, string $id): JsonResponse
    {
        $viewerId = $this->optionalViewerId($request);
        $l = $this->baseQuery()->where('l.id', $id)->first();
        if ($l === null) {
            throw ApiException::notFound('Lesson not found');
        }
        $bookedIds = $this->bookedLessonIds($viewerId, [$id]);

        return response()->json([
            ...$this->lessonPayload($l, $bookedIds),
            'description' => $l->description,
            'coach' => [
                'id' => $l->coach_id,
                'display_name' => $l->coach_name,
                'photo_url' => $l->coach_photo,
                'bio' => $l->coach_bio,
                'rating' => $l->coach_rating !== null ? (float) $l->coach_rating : null,
                'years_experience' => $l->coach_experience !== null ? (int) $l->coach_experience : null,
            ],
            'participants' => DB::table('lesson_bookings as lb')
                ->join('users as u', 'u.id', '=', 'lb.user_id')
                ->where('lb.lesson_id', $id)
                ->where('lb.status', 'booked')
                ->orderBy('lb.created_at')
                ->get(['u.id', 'u.display_name', 'u.photo_url']),
        ]);
    }

    /** POST /lessons/{id}/book — enroll the authenticated user. */
    public function book(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);

        return DB::transaction(function () use ($user, $id) {
            $lesson = DB::table('lessons')->where('id', $id)->lockForUpdate()->first();
            if ($lesson === null) {
                throw ApiException::notFound('Lesson not found');
            }
            if ($lesson->status !== 'scheduled') {
                throw ApiException::conflict('Lesson is not open for booking');
            }
            if (strtotime((string) $lesson->starts_at) <= time()) {
                throw ApiException::conflict('Lesson has already started');
            }

            $existing = DB::table('lesson_bookings')->where('lesson_id', $id)->where('user_id', $user->id)->first();
            if ($existing && $existing->status === 'booked') {
                return response()->json(['ok' => true, 'already_booked' => true]);
            }

            // Count active bookings (without locking an aggregate — the lesson row is already locked).
            $booked = (int) DB::table('lesson_bookings')->where('lesson_id', $id)->where('status', 'booked')->count();
            if ($booked >= (int) $lesson->capacity) {
                throw ApiException::conflict('Lesson is full');
            }

            DB::table('lesson_bookings')->updateOrInsert(
                ['lesson_id' => $id, 'user_id' => $user->id],
                ['id' => $existing->id ?? (string) Str::uuid(), 'status' => 'booked', 'updated_at' => now(), 'created_at' => $existing->created_at ?? now()],
            );

            return response()->json([
                'ok' => true,
                'spots_left' => max(0, (int) $lesson->capacity - ($booked + 1)),
            ]);
        });
    }

    /** DELETE /lessons/{id}/book — cancel the authenticated user's enrollment. */
    public function cancel(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        DB::table('lesson_bookings')
            ->where('lesson_id', $id)
            ->where('user_id', $user->id)
            ->update(['status' => 'cancelled', 'updated_at' => now()]);

        return response()->json(null, 204);
    }

    /** GET /me/lessons — the authenticated user's booked lessons (upcoming first). */
    public function mine(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $rows = $this->baseQuery()
            ->join('lesson_bookings as mine', function ($join) use ($user) {
                $join->on('mine.lesson_id', '=', 'l.id')
                    ->where('mine.user_id', '=', $user->id)
                    ->where('mine.status', '=', 'booked');
            })
            ->orderByRaw('l.starts_at >= now() desc')
            ->orderBy('l.starts_at')
            ->get();

        $bookedIds = $rows->pluck('id')->mapWithKeys(fn ($v) => [(string) $v => true])->all();

        return response()->json([
            'items' => $rows->map(fn ($l) => $this->lessonPayload($l, $bookedIds))->values(),
        ]);
    }

    /** GET /coaches — list active coaches (filters: sport, venue_id). */
    public function coaches(Request $request): JsonResponse
    {
        $query = DB::table('coaches as co')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'co.venue_id')
            ->where('co.is_active', true);

        if ($sport = $request->query('sport')) {
            $query->where('s.slug', $sport);
        }
        if ($venueId = $request->query('venue_id')) {
            $query->where('co.venue_id', $venueId);
        }

        $rows = $query->orderByDesc('co.rating')->orderBy('co.display_name')
            ->get([
                'co.id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency',
                's.slug as sport_slug', 'co.venue_id', 'v.name as venue_name',
            ]);

        return response()->json(['items' => $rows->map(fn ($c) => $this->coachPayload($c))->values()]);
    }

    /** GET /coaches/{id} — coach profile + their upcoming lessons. */
    public function coach(Request $request, string $id): JsonResponse
    {
        $viewerId = $this->optionalViewerId($request);
        $c = DB::table('coaches as co')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'co.venue_id')
            ->where('co.id', $id)
            ->first([
                'co.id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency',
                's.slug as sport_slug', 'co.venue_id', 'v.name as venue_name',
            ]);
        if ($c === null) {
            throw ApiException::notFound('Coach not found');
        }

        $upcoming = $this->baseQuery()
            ->where('l.coach_id', $id)
            ->where('l.status', 'scheduled')
            ->where('l.starts_at', '>=', now())
            ->orderBy('l.starts_at')
            ->limit(50)
            ->get();
        $bookedIds = $this->bookedLessonIds($viewerId, $upcoming->pluck('id')->all());

        return response()->json([
            ...$this->coachPayload($c),
            'bio' => $c->bio,
            'upcoming_lessons' => $upcoming->map(fn ($l) => $this->lessonPayload($l, $bookedIds))->values(),
        ]);
    }

    // ---- helpers ----

    private function baseQuery()
    {
        return DB::table('lessons as l')
            ->join('coaches as co', 'co.id', '=', 'l.coach_id')
            ->join('sports as s', 's.id', '=', 'l.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'l.venue_id')
            ->leftJoin('courts as c', 'c.id', '=', 'l.court_id')
            ->select([
                'l.id', 'l.coach_id', 'l.title', 'l.description', 'l.kind', 'l.level_label',
                'l.level_min_elo', 'l.level_max_elo', 'l.starts_at', 'l.duration_minutes',
                'l.capacity', 'l.price_minor', 'l.currency', 'l.status', 'l.venue_id', 'l.court_id',
                's.slug as sport_slug',
                'co.display_name as coach_name', 'co.photo_url as coach_photo', 'co.bio as coach_bio',
                'co.rating as coach_rating', 'co.years_experience as coach_experience',
                'v.name as venue_name', 'c.name as court_name',
            ])
            ->selectSub(
                DB::table('lesson_bookings')->selectRaw('count(*)')->whereColumn('lesson_id', 'l.id')->where('status', 'booked'),
                'booked_count',
            );
    }

    /** @param array<string,bool> $bookedIds */
    private function lessonPayload(object $l, array $bookedIds): array
    {
        $booked = (int) ($l->booked_count ?? 0);

        return [
            'id' => $l->id,
            'coach_id' => $l->coach_id,
            'coach_name' => $l->coach_name,
            'coach_photo_url' => $l->coach_photo,
            'title' => $l->title,
            'kind' => $l->kind,
            'sport_slug' => $l->sport_slug,
            'level_label' => $l->level_label,
            'level_min_elo' => $l->level_min_elo !== null ? (int) $l->level_min_elo : null,
            'level_max_elo' => $l->level_max_elo !== null ? (int) $l->level_max_elo : null,
            'starts_at' => $this->iso($l->starts_at),
            'duration_minutes' => (int) $l->duration_minutes,
            'capacity' => (int) $l->capacity,
            'booked_count' => $booked,
            'spots_left' => max(0, (int) $l->capacity - $booked),
            'price_minor' => $l->price_minor !== null ? (int) $l->price_minor : null,
            'currency' => $l->currency,
            'status' => $l->status,
            'venue_id' => $l->venue_id,
            'venue_name' => $l->venue_name,
            'court_name' => $l->court_name,
            'is_booked_by_me' => isset($bookedIds[(string) $l->id]),
            // Alias for clients that read `is_booked` (mobile lesson detail).
            'is_booked' => isset($bookedIds[(string) $l->id]),
        ];
    }

    private function coachPayload(object $c): array
    {
        return [
            'id' => $c->id,
            'display_name' => $c->display_name,
            'photo_url' => $c->photo_url,
            'rating' => $c->rating !== null ? (float) $c->rating : null,
            'years_experience' => $c->years_experience !== null ? (int) $c->years_experience : null,
            'hourly_rate_minor' => $c->hourly_rate_minor !== null ? (int) $c->hourly_rate_minor : null,
            'currency' => $c->currency,
            'sport_slug' => $c->sport_slug ?? null,
            'venue_id' => $c->venue_id,
            'venue_name' => $c->venue_name ?? null,
        ];
    }

    /**
     * @param  array<int,string>  $lessonIds
     * @return array<string,bool>
     */
    private function bookedLessonIds(?string $viewerId, array $lessonIds): array
    {
        if ($viewerId === null || $lessonIds === []) {
            return [];
        }

        return DB::table('lesson_bookings')
            ->where('user_id', $viewerId)
            ->where('status', 'booked')
            ->whereIn('lesson_id', $lessonIds)
            ->pluck('lesson_id')
            ->mapWithKeys(fn ($id) => [(string) $id => true])
            ->all();
    }
}
