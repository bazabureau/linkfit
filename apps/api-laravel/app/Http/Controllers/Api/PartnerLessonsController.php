<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Club-side ("Learn" SaaS) management of coaches and lessons. Every action is
 * scoped to the authenticated partner's venue. Mirrors the partner courts CRUD
 * conventions (PartnerOpsController).
 */
class PartnerLessonsController extends ApiController
{
    // ---- Coaches ----

    public function coaches(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);
        $rows = DB::table('coaches as co')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->where('co.venue_id', $venueId)
            ->orderByDesc('co.is_active')
            ->orderBy('co.display_name')
            ->get([
                'co.id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency',
                'co.is_active', 's.slug as sport_slug', 'co.sport_id',
            ]);

        return response()->json(['items' => $rows->map(fn ($c) => $this->coachPayload($c))->values()]);
    }

    public function createCoach(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'display_name' => ['required', 'string', 'min:2', 'max:120'],
            'sport_id' => ['sometimes', 'nullable', 'uuid'],
            'photo_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'hourly_rate_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'years_experience' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:80'],
        ]);
        $this->assertSport($data['sport_id'] ?? null);

        $id = (string) Str::uuid();
        DB::table('coaches')->insert([
            'id' => $id,
            'venue_id' => $venueId,
            'sport_id' => $data['sport_id'] ?? null,
            'display_name' => $data['display_name'],
            'photo_url' => $data['photo_url'] ?? null,
            'bio' => $data['bio'] ?? null,
            'hourly_rate_minor' => $data['hourly_rate_minor'] ?? null,
            'currency' => $data['currency'] ?? 'AZN',
            'years_experience' => $data['years_experience'] ?? null,
            'is_active' => true,
            'created_by' => $user->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->showCoach($venueId, $id, 201);
    }

    public function updateCoach(Request $request, string $id): JsonResponse
    {
        $venueId = $this->venueId($request);
        $this->ownedCoach($venueId, $id);
        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'min:2', 'max:120'],
            'sport_id' => ['sometimes', 'nullable', 'uuid'],
            'photo_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'hourly_rate_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'years_experience' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:80'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        if (array_key_exists('sport_id', $data)) {
            $this->assertSport($data['sport_id']);
        }
        $update = array_intersect_key($data, array_flip([
            'display_name', 'sport_id', 'photo_url', 'bio', 'hourly_rate_minor', 'currency', 'years_experience', 'is_active',
        ]));
        if ($update !== []) {
            $update['updated_at'] = now();
            DB::table('coaches')->where('id', $id)->update($update);
        }

        return $this->showCoach($venueId, $id);
    }

    public function deleteCoach(Request $request, string $id): JsonResponse
    {
        $venueId = $this->venueId($request);
        $this->ownedCoach($venueId, $id);
        // Deactivate (preserve history + linked lessons) rather than hard-delete,
        // cancel the coach's future scheduled lessons, and release every booked
        // player on those lessons so they are not left enrolled in a cancelled
        // lesson. All atomic so an enrolment is never orphaned mid-way.
        DB::transaction(function () use ($id): void {
            DB::table('coaches')->where('id', $id)->update(['is_active' => false, 'updated_at' => now()]);
            $lessonIds = DB::table('lessons')->where('coach_id', $id)->where('status', 'scheduled')
                ->where('starts_at', '>=', now())->pluck('id')->all();
            if ($lessonIds !== []) {
                DB::table('lessons')->whereIn('id', $lessonIds)->update(['status' => 'cancelled', 'updated_at' => now()]);
                DB::table('lesson_bookings')->whereIn('lesson_id', $lessonIds)->where('status', 'booked')
                    ->update(['status' => 'cancelled', 'updated_at' => now()]);
            }
        });

        return response()->json(null, 204);
    }

    // ---- Lessons ----

    public function lessons(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);
        $rows = $this->lessonQuery()
            ->where('l.venue_id', $venueId)
            ->orderByDesc('l.starts_at')
            ->limit(200)
            ->get();

        return response()->json(['items' => $rows->map(fn ($l) => $this->lessonPayload($l))->values()]);
    }

    public function createLesson(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'coach_id' => ['required', 'uuid'],
            'sport_id' => ['required', 'uuid'],
            'court_id' => ['sometimes', 'nullable', 'uuid'],
            'title' => ['required', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'kind' => ['sometimes', 'in:group,private'],
            'level_label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'level_min_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'level_max_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'capacity' => ['sometimes', 'integer', 'min:1', 'max:40'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
        ]);
        $this->ownedCoach($venueId, $data['coach_id']);
        $this->assertSport($data['sport_id']);
        if (! empty($data['court_id'])) {
            $this->ownedCourt($venueId, $data['court_id']);
        }
        if (strtotime($data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        if (isset($data['level_min_elo'], $data['level_max_elo']) && $data['level_min_elo'] !== null && $data['level_max_elo'] !== null && $data['level_min_elo'] > $data['level_max_elo']) {
            throw ApiException::validation('level_min_elo cannot exceed level_max_elo');
        }

        $kind = $data['kind'] ?? 'group';
        $capacity = isset($data['capacity']) ? (int) $data['capacity'] : ($kind === 'private' ? 1 : 4);

        $id = (string) Str::uuid();
        // Serialise concurrent creates for the same coach: lock the coach row, then
        // re-check the overlap and insert inside one transaction so two requests
        // cannot both pass the overlap check and double-book the coach.
        DB::transaction(function () use ($data, $venueId, $user, $id, $kind, $capacity): void {
            DB::table('coaches')->where('id', $data['coach_id'])->lockForUpdate()->first();
            $this->assertNoCoachOverlap($data['coach_id'], $data['starts_at'], (int) $data['duration_minutes']);
            DB::table('lessons')->insert([
                'id' => $id,
                'coach_id' => $data['coach_id'],
                'venue_id' => $venueId,
                'court_id' => $data['court_id'] ?? null,
                'sport_id' => $data['sport_id'],
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'kind' => $kind,
                'level_label' => $data['level_label'] ?? null,
                'level_min_elo' => $data['level_min_elo'] ?? null,
                'level_max_elo' => $data['level_max_elo'] ?? null,
                'starts_at' => $data['starts_at'],
                'duration_minutes' => $data['duration_minutes'],
                'capacity' => $capacity,
                'price_minor' => $data['price_minor'] ?? null,
                'currency' => $data['currency'] ?? 'AZN',
                'status' => 'scheduled',
                'created_by' => $user->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return $this->showLesson($venueId, $id, 201);
    }

    public function updateLesson(Request $request, string $id): JsonResponse
    {
        $venueId = $this->venueId($request);
        $this->ownedLesson($venueId, $id);
        $data = $this->validateBody($request, [
            'coach_id' => ['sometimes', 'uuid'],
            'court_id' => ['sometimes', 'nullable', 'uuid'],
            'title' => ['sometimes', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'kind' => ['sometimes', 'in:group,private'],
            'level_label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'level_min_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'level_max_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:4000'],
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
            'capacity' => ['sometimes', 'integer', 'min:1', 'max:40'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'status' => ['sometimes', 'in:scheduled,cancelled,completed'],
        ]);
        if (isset($data['coach_id'])) {
            $this->ownedCoach($venueId, $data['coach_id']);
        }
        if (! empty($data['court_id'])) {
            $this->ownedCourt($venueId, $data['court_id']);
        }
        // No rescheduling into the past, keep min<=max ELO, and don't double-book
        // the coach. Effective coach/start/duration = new value if given, else current.
        if (isset($data['starts_at']) && strtotime((string) $data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        if (isset($data['level_min_elo'], $data['level_max_elo']) && $data['level_min_elo'] !== null && $data['level_max_elo'] !== null && $data['level_min_elo'] > $data['level_max_elo']) {
            throw ApiException::validation('level_min_elo cannot exceed level_max_elo');
        }
        $update = array_intersect_key($data, array_flip([
            'coach_id', 'court_id', 'title', 'description', 'kind', 'level_label', 'level_min_elo',
            'level_max_elo', 'starts_at', 'duration_minutes', 'capacity', 'price_minor', 'currency', 'status',
        ]));
        // Lock the (effective) coach, re-check overlap, apply the update and — when
        // the lesson is being cancelled — release every booked player, all in one
        // transaction. This guards the coach double-book race and keeps enrolments
        // from being stranded on a now-cancelled lesson.
        DB::transaction(function () use ($id, $data, $update): void {
            if (isset($data['starts_at']) || isset($data['coach_id']) || isset($data['duration_minutes'])) {
                $current = DB::table('lessons')->where('id', $id)->first(['coach_id', 'starts_at', 'duration_minutes']);
                $coachId = (string) ($data['coach_id'] ?? $current->coach_id);
                DB::table('coaches')->where('id', $coachId)->lockForUpdate()->first();
                $this->assertNoCoachOverlap(
                    $coachId,
                    (string) ($data['starts_at'] ?? $current->starts_at),
                    (int) ($data['duration_minutes'] ?? $current->duration_minutes),
                    $id,
                );
            }
            if ($update !== []) {
                $update['updated_at'] = now();
                DB::table('lessons')->where('id', $id)->update($update);
            }
            if (($data['status'] ?? null) === 'cancelled') {
                DB::table('lesson_bookings')->where('lesson_id', $id)->where('status', 'booked')
                    ->update(['status' => 'cancelled', 'updated_at' => now()]);
            }
        });

        return $this->showLesson($venueId, $id);
    }

    public function deleteLesson(Request $request, string $id): JsonResponse
    {
        $venueId = $this->venueId($request);
        $this->ownedLesson($venueId, $id);
        // Cancel (preserve enrolment history) instead of hard-deleting, and release
        // every booked player so the lesson no longer shows as booked for them.
        DB::transaction(function () use ($id): void {
            DB::table('lessons')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now()]);
            DB::table('lesson_bookings')->where('lesson_id', $id)->where('status', 'booked')->update([
                'status' => 'cancelled',
                'updated_at' => now(),
            ]);
        });

        return response()->json(null, 204);
    }

    /** GET /partner/lessons/{id}/bookings — the enrolment roster. */
    public function roster(Request $request, string $id): JsonResponse
    {
        $venueId = $this->venueId($request);
        $this->ownedLesson($venueId, $id);
        $rows = DB::table('lesson_bookings as lb')
            ->join('users as u', 'u.id', '=', 'lb.user_id')
            ->where('lb.lesson_id', $id)
            ->orderBy('lb.created_at')
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'lb.status', 'lb.created_at as booked_at']);

        return response()->json([
            'items' => $rows->map(fn ($r) => [
                'id' => $r->id,
                'display_name' => $r->display_name,
                'photo_url' => $r->photo_url,
                'status' => $r->status,
                'booked_at' => $this->iso($r->booked_at),
            ])->values(),
            'booked_count' => $rows->where('status', 'booked')->count(),
        ]);
    }

    // ---- helpers ----

    private function venueId(Request $request): string
    {
        $user = $this->authUser($request);
        if ($user->admin_role !== 'partner') {
            throw ApiException::forbidden('Partner access required');
        }
        if ($user->venue_id === null) {
            throw ApiException::validation('Partner user has no venue_id');
        }

        return $user->venue_id;
    }

    private function assertSport(?string $sportId): void
    {
        if ($sportId === null) {
            return;
        }
        $ok = DB::table('sports')->where('id', $sportId)->whereIn('slug', ['padel', 'tennis'])->exists();
        if (! $ok) {
            throw ApiException::validation('Unknown sport_id');
        }
    }

    private function ownedCoach(string $venueId, string $coachId): void
    {
        if (! DB::table('coaches')->where('id', $coachId)->where('venue_id', $venueId)->exists()) {
            throw ApiException::notFound('Coach not found');
        }
    }

    private function ownedCourt(string $venueId, string $courtId): void
    {
        if (! DB::table('courts')->where('id', $courtId)->where('venue_id', $venueId)->exists()) {
            throw ApiException::validation('Unknown court_id for this venue');
        }
    }

    private function ownedLesson(string $venueId, string $lessonId): void
    {
        if (! DB::table('lessons')->where('id', $lessonId)->where('venue_id', $venueId)->exists()) {
            throw ApiException::notFound('Lesson not found');
        }
    }

    /**
     * Reject creating a lesson that overlaps another non-cancelled lesson for the
     * same coach. Overlap is computed in PHP (start/end as epoch seconds) so the
     * check is DB-dialect agnostic. Two windows [s1,e1) and [s2,e2) overlap iff
     * s1 < e2 && s2 < e1.
     */
    private function assertNoCoachOverlap(string $coachId, string $startsAt, int $durationMinutes, ?string $ignoreLessonId = null): void
    {
        $newStart = strtotime($startsAt);
        $newEnd = $newStart + $durationMinutes * 60;
        $existing = DB::table('lessons')
            ->where('coach_id', $coachId)
            ->where('status', '!=', 'cancelled')
            ->when($ignoreLessonId !== null, fn ($q) => $q->where('id', '!=', $ignoreLessonId))
            ->get(['starts_at', 'duration_minutes']);
        foreach ($existing as $row) {
            $s = strtotime((string) $row->starts_at);
            $e = $s + (int) $row->duration_minutes * 60;
            if ($newStart < $e && $s < $newEnd) {
                throw ApiException::conflict('Coach already has a lesson overlapping this time window');
            }
        }
    }

    private function showCoach(string $venueId, string $id, int $status = 200): JsonResponse
    {
        $c = DB::table('coaches as co')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->where('co.id', $id)->where('co.venue_id', $venueId)
            ->first([
                'co.id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency',
                'co.is_active', 's.slug as sport_slug', 'co.sport_id',
            ]);

        return response()->json($this->coachPayload($c), $status);
    }

    private function showLesson(string $venueId, string $id, int $status = 200): JsonResponse
    {
        $l = $this->lessonQuery()->where('l.id', $id)->where('l.venue_id', $venueId)->first();

        return response()->json($this->lessonPayload($l), $status);
    }

    private function lessonQuery()
    {
        return DB::table('lessons as l')
            ->join('coaches as co', 'co.id', '=', 'l.coach_id')
            ->join('sports as s', 's.id', '=', 'l.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'l.court_id')
            ->select([
                'l.id', 'l.coach_id', 'l.title', 'l.description', 'l.kind', 'l.level_label',
                'l.level_min_elo', 'l.level_max_elo', 'l.starts_at', 'l.duration_minutes',
                'l.capacity', 'l.price_minor', 'l.currency', 'l.status', 'l.venue_id', 'l.court_id',
                's.slug as sport_slug', 'co.display_name as coach_name', 'c.name as court_name',
            ])
            ->selectSub(
                DB::table('lesson_bookings')->selectRaw('count(*)')->whereColumn('lesson_id', 'l.id')->where('status', 'booked'),
                'booked_count',
            );
    }

    private function coachPayload(object $c): array
    {
        return [
            'id' => $c->id,
            'display_name' => $c->display_name,
            'photo_url' => $c->photo_url,
            'bio' => $c->bio,
            'rating' => $c->rating !== null ? (float) $c->rating : null,
            'years_experience' => $c->years_experience !== null ? (int) $c->years_experience : null,
            'hourly_rate_minor' => $c->hourly_rate_minor !== null ? (int) $c->hourly_rate_minor : null,
            'currency' => $c->currency,
            'sport_id' => $c->sport_id,
            'sport_slug' => $c->sport_slug ?? null,
            'is_active' => (bool) $c->is_active,
        ];
    }

    private function lessonPayload(object $l): array
    {
        $booked = (int) ($l->booked_count ?? 0);

        return [
            'id' => $l->id,
            'coach_id' => $l->coach_id,
            'coach_name' => $l->coach_name,
            'title' => $l->title,
            'description' => $l->description,
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
            'court_id' => $l->court_id,
            'court_name' => $l->court_name,
        ];
    }
}
