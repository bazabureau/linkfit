<?php

namespace App\Http\Controllers\Api;

use App\Services\Auth\PasswordService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Admin-wide management of coaches and lessons across ALL venues (the "Learn"
 * SaaS oversight). Admin/moderator only. Mirrors PartnerLessonsController but
 * not scoped to a single venue — venue_id is an explicit field/filter.
 */
class AdminLessonsController extends ApiController
{
    // ---- Coaches ----

    public function coaches(Request $request): JsonResponse
    {
        $this->staff($request);
        $this->validateQuery($request, [
            'venue_id' => ['sometimes', 'uuid'],
            'sport' => ['sometimes', 'in:padel,tennis'],
            'is_active' => ['sometimes', 'boolean'],
            'q' => ['sometimes', 'string', 'max:120'],
        ]);
        $query = DB::table('coaches as co')
            ->leftJoin('users as u', 'u.id', '=', 'co.user_id')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'co.venue_id');

        if ($venueId = $request->query('venue_id')) {
            $query->where('co.venue_id', $venueId);
        }
        if ($sport = $request->query('sport')) {
            $query->where('s.slug', $sport);
        }
        if (($active = $request->query('is_active')) !== null && $active !== '') {
            $query->where('co.is_active', filter_var($active, FILTER_VALIDATE_BOOLEAN));
        }
        if ($q = $request->query('q')) {
            $query->where('co.display_name', 'ilike', '%'.$q.'%');
        }

        $rows = $query->orderByDesc('co.is_active')->orderBy('co.display_name')->limit(500)->get([
            'co.id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
            'co.years_experience', 'co.hourly_rate_minor', 'co.currency', 'co.is_active',
            'co.user_id', 'u.email as user_email', 'co.sport_id', 's.slug as sport_slug', 'co.venue_id', 'v.name as venue_name',
        ]);

        return response()->json(['items' => $rows->map(fn ($c) => $this->coachPayload($c))->values()]);
    }

    public function createCoach(Request $request): JsonResponse
    {
        $user = $this->staff($request);
        $data = $this->validateBody($request, [
            'venue_id' => ['required', 'uuid'],
            'display_name' => ['required', 'string', 'min:2', 'max:120'],
            'sport_id' => ['sometimes', 'nullable', 'uuid'],
            'photo_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'hourly_rate_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'years_experience' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:80'],
            'rating' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:5'],
            'user_id' => ['sometimes', 'nullable', 'uuid'],
            'email' => ['sometimes', 'nullable', 'email', 'max:254'],
            'password' => ['sometimes', 'nullable', 'string', 'min:12', 'max:200'],
            'email_verified' => ['sometimes', 'boolean'],
        ]);
        $this->assertVenue($data['venue_id']);
        $this->assertSport($data['sport_id'] ?? null);

        $id = (string) Str::uuid();
        // Coach creation spans multiple dependent writes (optional users insert in
        // resolveCoachUserId, coaches insert, users.admin_role update, and the
        // credential sync which can throw on a duplicate email). Wrap them so a
        // later failure never leaves an orphaned/partial coach+user pair.
        DB::transaction(function () use ($id, $data, $user): void {
            $linkedUserId = $this->resolveCoachUserId($data, $data['display_name']);
            DB::table('coaches')->insert([
                'id' => $id,
                'user_id' => $linkedUserId,
                'venue_id' => $data['venue_id'],
                'sport_id' => $data['sport_id'] ?? null,
                'display_name' => $data['display_name'],
                'photo_url' => $data['photo_url'] ?? null,
                'bio' => $data['bio'] ?? null,
                'hourly_rate_minor' => $data['hourly_rate_minor'] ?? null,
                'currency' => $data['currency'] ?? 'AZN',
                'years_experience' => $data['years_experience'] ?? null,
                'rating' => $data['rating'] ?? null,
                'is_active' => true,
                'created_by' => $user->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            if ($linkedUserId !== null) {
                DB::table('users')->where('id', $linkedUserId)->update([
                    'admin_role' => 'coach',
                    'updated_at' => now(),
                ]);
                $this->syncCoachUserCredentials($linkedUserId, $data, $data['display_name']);
            }
        });

        return $this->showCoach($id, 201);
    }

    public function updateCoach(Request $request, string $id): JsonResponse
    {
        $this->staff($request);
        $this->assertCoach($id);
        $data = $this->validateBody($request, [
            'venue_id' => ['sometimes', 'uuid'],
            'display_name' => ['sometimes', 'string', 'min:2', 'max:120'],
            'sport_id' => ['sometimes', 'nullable', 'uuid'],
            'photo_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'hourly_rate_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'years_experience' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:80'],
            'rating' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:5'],
            'is_active' => ['sometimes', 'boolean'],
            'user_id' => ['sometimes', 'nullable', 'uuid'],
            'email' => ['sometimes', 'nullable', 'email', 'max:254'],
            'password' => ['sometimes', 'nullable', 'string', 'min:12', 'max:200'],
            'email_verified' => ['sometimes', 'boolean'],
        ]);
        if (isset($data['venue_id'])) {
            $this->assertVenue($data['venue_id']);
        }
        if (array_key_exists('sport_id', $data)) {
            $this->assertSport($data['sport_id']);
        }
        // The coach update can resolve/insert a linked user, update the coaches
        // row, promote the user's admin_role, and sync credentials (which can
        // throw on a duplicate email). Wrap them so a partial failure rolls back
        // rather than leaving a half-updated coach+user pair.
        DB::transaction(function () use ($id, $data): void {
            if (array_key_exists('user_id', $data) || ! empty($data['email'])) {
                $displayName = (string) ($data['display_name'] ?? DB::table('coaches')->where('id', $id)->value('display_name') ?? 'Coach');
                $data['user_id'] = $this->resolveCoachUserId($data, $displayName, $id);
            }
            $update = array_intersect_key($data, array_flip([
                'venue_id', 'display_name', 'sport_id', 'photo_url', 'bio', 'hourly_rate_minor',
                'currency', 'years_experience', 'rating', 'is_active', 'user_id',
            ]));
            if ($update !== []) {
                $update['updated_at'] = now();
                DB::table('coaches')->where('id', $id)->update($update);
                if (isset($update['user_id'])) {
                    DB::table('users')->where('id', $update['user_id'])->update([
                        'admin_role' => 'coach',
                        'updated_at' => now(),
                    ]);
                }
            }
            $targetUserId = $update['user_id'] ?? DB::table('coaches')->where('id', $id)->value('user_id');
            if ($targetUserId !== null && ($update !== [] || ! empty($data['email']) || ! empty($data['password']) || array_key_exists('email_verified', $data))) {
                $this->syncCoachUserCredentials((string) $targetUserId, $data, (string) ($update['display_name'] ?? DB::table('coaches')->where('id', $id)->value('display_name') ?? 'Coach'));
            }
        });

        return $this->showCoach($id);
    }

    public function deleteCoach(Request $request, string $id): JsonResponse
    {
        $this->staff($request);
        $this->assertCoach($id);
        // Deactivating the coach and cancelling their future lessons must commit
        // together so a failure can't leave an inactive coach with still-scheduled
        // lessons (mirrors the transaction in deleteLesson()).
        DB::transaction(function () use ($id): void {
            DB::table('coaches')->where('id', $id)->update(['is_active' => false, 'updated_at' => now()]);
            DB::table('lessons')->where('coach_id', $id)->where('status', 'scheduled')
                ->where('starts_at', '>=', now())->update(['status' => 'cancelled', 'updated_at' => now()]);
        });

        return response()->json(null, 204);
    }

    // ---- Lessons ----

    public function lessons(Request $request): JsonResponse
    {
        $this->staff($request);
        $this->validateQuery($request, [
            'venue_id' => ['sometimes', 'uuid'],
            'sport' => ['sometimes', 'in:padel,tennis'],
            'status' => ['sometimes', 'in:scheduled,cancelled,completed'],
            'kind' => ['sometimes', 'in:group,private'],
        ]);
        $query = $this->lessonQuery();

        if ($venueId = $request->query('venue_id')) {
            $query->where('l.venue_id', $venueId);
        }
        if ($sport = $request->query('sport')) {
            $query->where('s.slug', $sport);
        }
        if ($status = $request->query('status')) {
            $query->where('l.status', $status);
        }
        if ($kind = $request->query('kind')) {
            $query->where('l.kind', $kind);
        }

        $rows = $query->orderByDesc('l.starts_at')->limit(500)->get();

        return response()->json(['items' => $rows->map(fn ($l) => $this->lessonPayload($l))->values()]);
    }

    public function createLesson(Request $request): JsonResponse
    {
        $user = $this->staff($request);
        $data = $this->validateBody($request, [
            'venue_id' => ['required', 'uuid'],
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
        $this->assertVenue($data['venue_id']);
        $this->assertCoach($data['coach_id']);
        $this->assertSport($data['sport_id']);
        if (strtotime($data['starts_at']) <= time()) {
            throw ApiException::validation('starts_at must be in the future');
        }
        $this->assertNoCoachOverlap($data['coach_id'], $data['starts_at'], (int) $data['duration_minutes']);

        $kind = $data['kind'] ?? 'group';
        $capacity = isset($data['capacity']) ? (int) $data['capacity'] : ($kind === 'private' ? 1 : 4);

        $id = (string) Str::uuid();
        DB::table('lessons')->insert([
            'id' => $id,
            'coach_id' => $data['coach_id'],
            'venue_id' => $data['venue_id'],
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

        return $this->showLesson($id, 201);
    }

    public function updateLesson(Request $request, string $id): JsonResponse
    {
        $this->staff($request);
        $this->assertLesson($id);
        $data = $this->validateBody($request, [
            'venue_id' => ['sometimes', 'uuid'],
            'coach_id' => ['sometimes', 'uuid'],
            'sport_id' => ['sometimes', 'uuid'],
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
            $this->assertCoach($data['coach_id']);
        }
        if (isset($data['venue_id'])) {
            $this->assertVenue($data['venue_id']);
        }
        if (isset($data['sport_id'])) {
            $this->assertSport($data['sport_id']);
        }
        $update = array_intersect_key($data, array_flip([
            'venue_id', 'coach_id', 'sport_id', 'court_id', 'title', 'description', 'kind', 'level_label', 'level_min_elo',
            'level_max_elo', 'starts_at', 'duration_minutes', 'capacity', 'price_minor', 'currency', 'status',
        ]));
        if ($update !== []) {
            $update['updated_at'] = now();
            DB::table('lessons')->where('id', $id)->update($update);
        }

        return $this->showLesson($id);
    }

    public function deleteLesson(Request $request, string $id): JsonResponse
    {
        $this->staff($request);
        $this->assertLesson($id);
        // Cancel and release every booked player so the lesson no longer shows as
        // booked for the enrolled players.
        DB::transaction(function () use ($id): void {
            DB::table('lessons')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now()]);
            DB::table('lesson_bookings')->where('lesson_id', $id)->where('status', 'booked')->update([
                'status' => 'cancelled',
                'updated_at' => now(),
            ]);
        });

        return response()->json(null, 204);
    }

    public function roster(Request $request, string $id): JsonResponse
    {
        $this->staff($request);
        $this->assertLesson($id);
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

    private function staff(Request $request): object
    {
        $user = $this->authUser($request);
        if (! in_array($user->admin_role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Admin access required');
        }

        return $user;
    }

    private function assertVenue(string $venueId): void
    {
        if (! DB::table('venues')->where('id', $venueId)->exists()) {
            throw ApiException::validation('Unknown venue_id');
        }
    }

    private function assertSport(?string $sportId): void
    {
        if ($sportId === null) {
            return;
        }
        if (! DB::table('sports')->where('id', $sportId)->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
    }

    private function assertCoach(string $coachId): void
    {
        if (! DB::table('coaches')->where('id', $coachId)->exists()) {
            throw ApiException::notFound('Coach not found');
        }
    }

    private function assertLesson(string $lessonId): void
    {
        if (! DB::table('lessons')->where('id', $lessonId)->exists()) {
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

    private function showCoach(string $id, int $status = 200): JsonResponse
    {
        $c = DB::table('coaches as co')
            ->leftJoin('users as u', 'u.id', '=', 'co.user_id')
            ->leftJoin('sports as s', 's.id', '=', 'co.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'co.venue_id')
            ->where('co.id', $id)
            ->first([
                'co.id', 'co.display_name', 'co.photo_url', 'co.bio', 'co.rating',
                'co.years_experience', 'co.hourly_rate_minor', 'co.currency', 'co.is_active',
                'co.user_id', 'u.email as user_email', 'co.sport_id', 's.slug as sport_slug', 'co.venue_id', 'v.name as venue_name',
            ]);

        return response()->json($this->coachPayload($c), $status);
    }

    private function showLesson(string $id, int $status = 200): JsonResponse
    {
        $l = $this->lessonQuery()->where('l.id', $id)->first();

        return response()->json($this->lessonPayload($l), $status);
    }

    private function lessonQuery()
    {
        return DB::table('lessons as l')
            ->join('coaches as co', 'co.id', '=', 'l.coach_id')
            ->join('sports as s', 's.id', '=', 'l.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 'l.venue_id')
            ->leftJoin('courts as c', 'c.id', '=', 'l.court_id')
            ->select([
                'l.id', 'l.coach_id', 'l.title', 'l.description', 'l.kind', 'l.level_label',
                'l.level_min_elo', 'l.level_max_elo', 'l.starts_at', 'l.duration_minutes',
                'l.capacity', 'l.price_minor', 'l.currency', 'l.status', 'l.venue_id', 'l.court_id', 'l.sport_id',
                's.slug as sport_slug', 'co.display_name as coach_name', 'v.name as venue_name', 'c.name as court_name',
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
            'user_id' => $c->user_id ?? null,
            'user_email' => $c->user_email ?? null,
            'display_name' => $c->display_name,
            'photo_url' => $c->photo_url,
            'bio' => $c->bio,
            'rating' => $c->rating !== null ? (float) $c->rating : null,
            'years_experience' => $c->years_experience !== null ? (int) $c->years_experience : null,
            'hourly_rate_minor' => $c->hourly_rate_minor !== null ? (int) $c->hourly_rate_minor : null,
            'currency' => $c->currency,
            'sport_id' => $c->sport_id,
            'sport_slug' => $c->sport_slug ?? null,
            'venue_id' => $c->venue_id,
            'venue_name' => $c->venue_name ?? null,
            'is_active' => (bool) $c->is_active,
        ];
    }

    private function resolveCoachUserId(array $data, string $displayName, ?string $ignoreCoachId = null): ?string
    {
        if (! empty($data['user_id'])) {
            $user = DB::table('users')->where('id', $data['user_id'])->whereNull('deleted_at')->first(['id', 'admin_role']);
            if ($user === null) {
                throw ApiException::validation('Unknown user_id');
            }
            $alreadyLinked = DB::table('coaches')
                ->where('user_id', $user->id)
                ->when($ignoreCoachId !== null, fn ($q) => $q->where('id', '!=', $ignoreCoachId))
                ->exists();
            if ($alreadyLinked) {
                throw ApiException::conflict('User is already linked to a coach profile');
            }

            return (string) $user->id;
        }

        if (empty($data['email'])) {
            return null;
        }
        if (empty($data['password'])) {
            throw ApiException::validation('Password is required when creating a coach login account');
        }
        $this->assertPasswordPolicy((string) $data['password']);
        $email = mb_strtolower(trim((string) $data['email']));
        if (DB::table('users')->where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }

        $userId = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $userId,
            'email' => $email,
            'password_hash' => app(PasswordService::class)->hash((string) $data['password']),
            'display_name' => trim($displayName),
            'admin_role' => 'coach',
            'email_verified_at' => ! empty($data['email_verified']) ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $userId;
    }

    private function assertPasswordPolicy(string $password): void
    {
        if (strlen($password) < 12 || ! preg_match('/[A-Za-z]/', $password) || ! preg_match('/\d/', $password)) {
            throw ApiException::validation('Password must be at least 12 characters and contain a letter and a digit');
        }
    }

    private function syncCoachUserCredentials(string $userId, array $data, string $displayName): void
    {
        $updates = [
            'display_name' => trim($displayName),
            'admin_role' => 'coach',
            'updated_at' => now(),
        ];
        if (! empty($data['password'])) {
            $this->assertPasswordPolicy((string) $data['password']);
            $updates['password_hash'] = app(PasswordService::class)->hash((string) $data['password']);
        }
        if (! empty($data['email'])) {
            $email = mb_strtolower(trim((string) $data['email']));
            $exists = DB::table('users')->where('email', $email)->where('id', '!=', $userId)->exists();
            if ($exists) {
                throw ApiException::conflict('Email is already registered');
            }
            $updates['email'] = $email;
        }
        if (array_key_exists('email_verified', $data)) {
            $updates['email_verified_at'] = ! empty($data['email_verified']) ? now() : null;
        }

        DB::table('users')->where('id', $userId)->update($updates);
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
            'sport_id' => $l->sport_id,
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
            'court_id' => $l->court_id,
            'court_name' => $l->court_name,
        ];
    }
}
