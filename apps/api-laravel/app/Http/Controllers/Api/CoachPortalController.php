<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CoachPortalController extends ApiController
{
    public function bootstrap(Request $request): JsonResponse
    {
        $coach = $this->coachFor($request);
        $lessons = $this->lessonQuery($coach->id)
            ->orderByDesc('l.starts_at')
            ->limit(100)
            ->get();

        $upcoming = $lessons->filter(fn ($l) => $l->status === 'scheduled' && strtotime((string) $l->starts_at) >= time());
        $bookedCount = (int) DB::table('lesson_bookings as lb')
            ->join('lessons as l', 'l.id', '=', 'lb.lesson_id')
            ->where('l.coach_id', $coach->id)
            ->where('lb.status', 'booked')
            ->count();

        return response()->json([
            'coach' => $this->coachPayload($coach),
            'courts' => $this->courtsFor($coach),
            'stats' => [
                'upcoming_lessons' => $upcoming->count(),
                'active_bookings' => $bookedCount,
                'private_lessons' => $lessons->where('kind', 'private')->count(),
                'group_lessons' => $lessons->where('kind', 'group')->count(),
            ],
            'lessons' => $lessons->map(fn ($l) => $this->lessonPayload($l))->values(),
        ]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $coach = $this->coachFor($request);
        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'min:2', 'max:120'],
            'photo_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'hourly_rate_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'years_experience' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:80'],
        ]);

        $update = array_intersect_key($data, array_flip([
            'display_name', 'photo_url', 'bio', 'hourly_rate_minor', 'currency', 'years_experience',
        ]));
        if ($update !== []) {
            $update['updated_at'] = now();
            DB::table('coaches')->where('id', $coach->id)->update($update);
            if (isset($update['display_name'])) {
                DB::table('users')->where('id', $coach->user_id)->update([
                    'display_name' => $update['display_name'],
                    'updated_at' => now(),
                ]);
            }
        }

        return response()->json($this->coachPayload($this->coachById((string) $coach->id)));
    }

    public function lessons(Request $request): JsonResponse
    {
        $coach = $this->coachFor($request);

        return response()->json([
            'items' => $this->lessonQuery($coach->id)
                ->orderByDesc('l.starts_at')
                ->limit(200)
                ->get()
                ->map(fn ($l) => $this->lessonPayload($l))
                ->values(),
        ]);
    }

    public function createLesson(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $coach = $this->coachFor($request);
        $data = $this->validateBody($request, [
            'court_id' => ['sometimes', 'nullable', 'uuid'],
            'title' => ['required', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'kind' => ['sometimes', 'in:group,private'],
            'level_label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'capacity' => ['sometimes', 'integer', 'min:1', 'max:40'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
        ]);
        if (strtotime($data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        if (! empty($data['court_id'])) {
            $this->assertCourt((string) $coach->venue_id, $data['court_id']);
        }

        $sportId = $coach->sport_id ?: DB::table('sports')->where('slug', 'padel')->value('id');
        if ($sportId === null) {
            throw ApiException::validation('Coach has no sport_id');
        }

        $kind = $data['kind'] ?? 'group';
        $capacity = isset($data['capacity']) ? (int) $data['capacity'] : ($kind === 'private' ? 1 : 4);
        if ($kind === 'private' && $capacity !== 1) {
            throw ApiException::validation('Private lessons must have capacity 1');
        }
        $id = (string) Str::uuid();
        DB::table('lessons')->insert([
            'id' => $id,
            'coach_id' => $coach->id,
            'venue_id' => $coach->venue_id,
            'court_id' => $data['court_id'] ?? null,
            'sport_id' => $sportId,
            'title' => $data['title'],
            'description' => $data['description'] ?? null,
            'kind' => $kind,
            'level_label' => $data['level_label'] ?? null,
            'starts_at' => $data['starts_at'],
            'duration_minutes' => $data['duration_minutes'],
            'capacity' => $capacity,
            'price_minor' => $data['price_minor'] ?? $coach->hourly_rate_minor,
            'currency' => $data['currency'] ?? $coach->currency ?? 'AZN',
            'status' => 'scheduled',
            'created_by' => $user->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json($this->lessonPayload($this->lessonQuery($coach->id)->where('l.id', $id)->first()), 201);
    }

    public function updateLesson(Request $request, string $id): JsonResponse
    {
        $coach = $this->coachFor($request);
        $this->assertLesson($coach->id, $id);
        $data = $this->validateBody($request, [
            'court_id' => ['sometimes', 'nullable', 'uuid'],
            'title' => ['sometimes', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'kind' => ['sometimes', 'in:group,private'],
            'level_label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
            'capacity' => ['sometimes', 'integer', 'min:1', 'max:40'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'status' => ['sometimes', 'in:scheduled,cancelled,completed'],
        ]);
        if (! empty($data['court_id'])) {
            $this->assertCourt((string) $coach->venue_id, $data['court_id']);
        }
        if (isset($data['starts_at']) && strtotime($data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        if (($data['kind'] ?? null) === 'private' && isset($data['capacity']) && (int) $data['capacity'] !== 1) {
            throw ApiException::validation('Private lessons must have capacity 1');
        }
        if (isset($data['capacity'])) {
            $booked = (int) DB::table('lesson_bookings')->where('lesson_id', $id)->where('status', 'booked')->count();
            if ((int) $data['capacity'] < $booked) {
                throw ApiException::validation('capacity cannot be lower than current bookings');
            }
        }

        $update = array_intersect_key($data, array_flip([
            'court_id', 'title', 'description', 'kind', 'level_label', 'starts_at',
            'duration_minutes', 'capacity', 'price_minor', 'currency', 'status',
        ]));
        if ($update !== []) {
            $update['updated_at'] = now();
            DB::table('lessons')->where('id', $id)->where('coach_id', $coach->id)->update($update);
        }

        return response()->json($this->lessonPayload($this->lessonQuery($coach->id)->where('l.id', $id)->first()));
    }

    public function cancelLesson(Request $request, string $id): JsonResponse
    {
        $coach = $this->coachFor($request);
        $this->assertLesson($coach->id, $id);
        DB::table('lessons')->where('id', $id)->where('coach_id', $coach->id)->update([
            'status' => 'cancelled',
            'updated_at' => now(),
        ]);

        return response()->json($this->lessonPayload($this->lessonQuery($coach->id)->where('l.id', $id)->first()));
    }

    public function roster(Request $request, string $id): JsonResponse
    {
        $coach = $this->coachFor($request);
        $this->assertLesson($coach->id, $id);
        $rows = DB::table('lesson_bookings as lb')
            ->join('users as u', 'u.id', '=', 'lb.user_id')
            ->where('lb.lesson_id', $id)
            ->orderBy('lb.created_at')
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'lb.status', 'lb.created_at as booked_at']);

        return response()->json([
            'items' => $rows->map(fn ($r) => [
                'id' => (string) $r->id,
                'display_name' => (string) $r->display_name,
                'photo_url' => $r->photo_url,
                'status' => (string) $r->status,
                'booked_at' => $this->iso($r->booked_at),
            ])->values(),
            'booked_count' => $rows->where('status', 'booked')->count(),
        ]);
    }

    private function coachFor(Request $request): object
    {
        $user = $this->authUser($request);
        if ($user->admin_role !== 'coach') {
            throw ApiException::forbidden('Coach access required');
        }

        $coach = DB::table('coaches as co')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'co.venue_id')
            ->where('co.user_id', $user->id)
            ->where('co.is_active', true)
            ->first([
                'co.id', 'co.user_id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency', 'co.is_active',
                'co.sport_id', 's.slug as sport_slug', 'co.venue_id', 'v.name as venue_name',
            ]);
        if ($coach === null) {
            throw ApiException::forbidden('Coach account is not linked to an active coach profile');
        }

        return $coach;
    }

    private function coachById(string $id): object
    {
        $coach = DB::table('coaches as co')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'co.venue_id')
            ->where('co.id', $id)
            ->first([
                'co.id', 'co.user_id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency', 'co.is_active',
                'co.sport_id', 's.slug as sport_slug', 'co.venue_id', 'v.name as venue_name',
            ]);
        if ($coach === null) {
            throw ApiException::notFound('Coach not found');
        }

        return $coach;
    }

    private function assertCourt(string $venueId, string $courtId): void
    {
        if (! DB::table('courts')->where('id', $courtId)->where('venue_id', $venueId)->exists()) {
            throw ApiException::validation('Unknown court_id for this venue');
        }
    }

    private function assertLesson(string $coachId, string $lessonId): void
    {
        if (! DB::table('lessons')->where('id', $lessonId)->where('coach_id', $coachId)->exists()) {
            throw ApiException::notFound('Lesson not found');
        }
    }

    private function courtsFor(object $coach)
    {
        if (empty($coach->venue_id)) {
            return collect();
        }

        return DB::table('courts as c')
            ->leftJoin('sports as s', 's.id', '=', 'c.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.venue_id', $coach->venue_id)
            ->orderBy('c.name')
            ->get([
                'c.id',
                'c.name',
                'c.venue_id',
                'v.name as venue_name',
                'c.status',
                's.slug as sport_slug',
            ])
            ->map(fn ($c) => [
                'id' => (string) $c->id,
                'name' => (string) $c->name,
                'venue_id' => (string) $c->venue_id,
                'venue_name' => $c->venue_name,
                'status' => $c->status,
                'sport_slug' => $c->sport_slug,
            ])
            ->values();
    }

    private function lessonQuery(string $coachId)
    {
        return DB::table('lessons as l')
            ->join('coaches as co', 'co.id', '=', 'l.coach_id')
            ->join('sports as s', 's.id', '=', 'l.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'l.venue_id')
            ->leftJoin('courts as c', 'c.id', '=', 'l.court_id')
            ->where('l.coach_id', $coachId)
            ->select([
                'l.id', 'l.coach_id', 'l.title', 'l.description', 'l.kind', 'l.level_label',
                'l.level_min_elo', 'l.level_max_elo', 'l.starts_at', 'l.duration_minutes',
                'l.capacity', 'l.price_minor', 'l.currency', 'l.status', 'l.venue_id', 'l.court_id',
                's.slug as sport_slug', 'co.display_name as coach_name', 'c.name as court_name', 'v.name as venue_name',
            ])
            ->selectSub(
                DB::table('lesson_bookings')->selectRaw('count(*)')->whereColumn('lesson_id', 'l.id')->where('status', 'booked'),
                'booked_count',
            );
    }

    private function coachPayload(object $c): array
    {
        return [
            'id' => (string) $c->id,
            'user_id' => isset($c->user_id) ? (string) $c->user_id : null,
            'display_name' => (string) $c->display_name,
            'photo_url' => $c->photo_url,
            'bio' => $c->bio ?? null,
            'rating' => $c->rating !== null ? (float) $c->rating : null,
            'years_experience' => $c->years_experience !== null ? (int) $c->years_experience : null,
            'hourly_rate_minor' => $c->hourly_rate_minor !== null ? (int) $c->hourly_rate_minor : null,
            'currency' => $c->currency,
            'is_active' => (bool) $c->is_active,
            'sport_id' => $c->sport_id ?? null,
            'sport_slug' => $c->sport_slug ?? null,
            'venue_id' => $c->venue_id ?? null,
            'venue_name' => $c->venue_name ?? null,
        ];
    }

    private function lessonPayload(object $l): array
    {
        $booked = (int) ($l->booked_count ?? 0);

        return [
            'id' => (string) $l->id,
            'coach_id' => (string) $l->coach_id,
            'coach_name' => $l->coach_name ?? null,
            'title' => (string) $l->title,
            'description' => $l->description ?? null,
            'kind' => (string) $l->kind,
            'sport_slug' => $l->sport_slug ?? null,
            'level_label' => $l->level_label ?? null,
            'starts_at' => $this->iso($l->starts_at),
            'duration_minutes' => (int) $l->duration_minutes,
            'capacity' => (int) $l->capacity,
            'booked_count' => $booked,
            'spots_left' => max(0, (int) $l->capacity - $booked),
            'price_minor' => $l->price_minor !== null ? (int) $l->price_minor : null,
            'currency' => $l->currency,
            'status' => (string) $l->status,
            'venue_id' => $l->venue_id ?? null,
            'venue_name' => $l->venue_name ?? null,
            'court_id' => $l->court_id ?? null,
            'court_name' => $l->court_name ?? null,
        ];
    }
}
