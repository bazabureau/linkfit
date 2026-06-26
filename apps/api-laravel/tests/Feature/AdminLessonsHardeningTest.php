<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminLessonsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the admin-wide "Learn" management slice (coaches +
 * lessons across all venues): staff-only authorization, the court_id /
 * level-ELO / future-start / coach-overlap input guards on create+update, and
 * the cancel/roster behaviour. Drives the controller directly with a synthetic
 * Request (mirrors CoachPortalControllerTest) over an in-memory SQLite DB.
 */
class AdminLessonsHardeningTest extends TestCase
{
    private const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

    private const PLAYER_ID = '00000000-0000-4000-8000-000000000002';

    private const VENUE_ID = '00000000-0000-4000-8000-000000000010';

    private const VENUE2_ID = '00000000-0000-4000-8000-000000000011';

    private const COURT_ID = '00000000-0000-4000-8000-000000000020';

    private const COURT2_ID = '00000000-0000-4000-8000-000000000021';

    private const SPORT_ID = '00000000-0000-4000-8000-000000000030';

    private const COACH_ID = '00000000-0000-4000-8000-000000000040';

    private const MISSING_UUID = '00000000-0000-4000-8000-0000000000ff';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('password_hash')->nullable();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->string('admin_role')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('sport_id')->nullable();
            $table->string('name');
            $table->string('status')->nullable();
        });
        Schema::create('coaches', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id')->nullable();
            $table->string('venue_id')->nullable();
            $table->string('sport_id')->nullable();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->text('bio')->nullable();
            $table->integer('hourly_rate_minor')->nullable();
            $table->string('currency')->nullable();
            $table->float('rating')->nullable();
            $table->integer('years_experience')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('created_by')->nullable();
            $table->timestamps();
        });
        Schema::create('lessons', function ($table): void {
            $table->string('id')->primary();
            $table->string('coach_id');
            $table->string('venue_id')->nullable();
            $table->string('court_id')->nullable();
            $table->string('sport_id');
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('kind');
            $table->string('level_label')->nullable();
            $table->integer('level_min_elo')->nullable();
            $table->integer('level_max_elo')->nullable();
            $table->dateTime('starts_at');
            $table->integer('duration_minutes');
            $table->integer('capacity');
            $table->integer('price_minor')->nullable();
            $table->string('currency')->nullable();
            $table->string('status');
            $table->string('created_by')->nullable();
            $table->timestamps();
        });
        Schema::create('lesson_bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('lesson_id');
            $table->string('user_id');
            $table->string('status');
            $table->timestamps();
        });

        DB::table('users')->insert([
            ['id' => self::ADMIN_ID, 'email' => 'admin@linkfit.az', 'display_name' => 'Admin', 'admin_role' => 'admin', 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER_ID, 'email' => 'player@linkfit.az', 'display_name' => 'Player', 'admin_role' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT_ID, 'slug' => 'padel']);
        DB::table('venues')->insert([
            ['id' => self::VENUE_ID, 'name' => 'LinkFit Arena'],
            ['id' => self::VENUE2_ID, 'name' => 'Other Club'],
        ]);
        DB::table('courts')->insert([
            ['id' => self::COURT_ID, 'venue_id' => self::VENUE_ID, 'sport_id' => self::SPORT_ID, 'name' => 'Court 1', 'status' => 'active'],
            ['id' => self::COURT2_ID, 'venue_id' => self::VENUE2_ID, 'sport_id' => self::SPORT_ID, 'name' => 'Court A', 'status' => 'active'],
        ]);
        DB::table('coaches')->insert([
            'id' => self::COACH_ID, 'user_id' => null, 'venue_id' => self::VENUE_ID, 'sport_id' => self::SPORT_ID,
            'display_name' => 'Coach One', 'is_active' => true, 'currency' => 'AZN',
            'created_by' => self::ADMIN_ID, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['lesson_bookings', 'lessons', 'coaches', 'courts', 'venues', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- create: happy path + authz -----------------------------------------

    public function test_create_lesson_happy_path(): void
    {
        $res = app(AdminLessonsController::class)->createLesson($this->request('POST', $this->basePayload()));
        $data = $res->getData(true);

        $this->assertSame(201, $res->getStatusCode());
        $this->assertSame(self::COACH_ID, $data['coach_id']);
        $this->assertSame(self::COURT_ID, $data['court_id']);
        $this->assertSame(0, $data['booked_count']);
        $this->assertSame((int) $data['capacity'], $data['spots_left']);
        $this->assertSame('scheduled', $data['status']);
        $this->assertSame(1, DB::table('lessons')->count());
    }

    public function test_create_lesson_rejects_non_staff(): void
    {
        $this->assertStatus(403, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(), self::PLAYER_ID)));
        $this->assertSame(0, DB::table('lessons')->count());
    }

    public function test_create_lesson_requires_authentication(): void
    {
        $this->assertStatus(401, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(), null)));
    }

    // ---- create: input validation guards ------------------------------------

    public function test_create_lesson_rejects_unknown_court(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(['court_id' => self::MISSING_UUID]))));
        $this->assertSame(0, DB::table('lessons')->count());
    }

    public function test_create_lesson_rejects_court_from_another_venue(): void
    {
        // Court 2 belongs to VENUE2; the lesson is being created at VENUE1.
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(['court_id' => self::COURT2_ID]))));
        $this->assertSame(0, DB::table('lessons')->count());
    }

    public function test_create_lesson_rejects_min_elo_above_max(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(['level_min_elo' => 1500, 'level_max_elo' => 1000]))));
        $this->assertSame(0, DB::table('lessons')->count());
    }

    public function test_create_lesson_rejects_past_start(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(['starts_at' => now()->subHour()->toIso8601String()]))));
    }

    public function test_create_lesson_rejects_unknown_coach(): void
    {
        $this->assertStatus(404, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(['coach_id' => self::MISSING_UUID]))));
    }

    public function test_create_lesson_rejects_unknown_venue(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload(['venue_id' => self::MISSING_UUID]))));
    }

    public function test_create_lesson_rejects_overlapping_coach(): void
    {
        $start = now()->addDays(2)->setTime(10, 0);
        $this->makeLesson('aaaaaaaa-0000-4000-8000-000000000001', $start, 60);

        // Overlaps the existing 10:00-11:00 window for the same coach.
        $this->assertStatus(409, fn () => app(AdminLessonsController::class)
            ->createLesson($this->request('POST', $this->basePayload([
                'starts_at' => $start->copy()->addMinutes(30)->toIso8601String(),
            ]))));
        $this->assertSame(1, DB::table('lessons')->count());
    }

    // ---- update: input validation guards ------------------------------------

    public function test_update_lesson_rejects_unknown_court(): void
    {
        $id = 'bbbbbbbb-0000-4000-8000-000000000001';
        $this->makeLesson($id, now()->addDays(3), 60);

        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->updateLesson($this->request('PUT', ['court_id' => self::MISSING_UUID]), $id));
    }

    public function test_update_lesson_rejects_court_from_another_venue(): void
    {
        $id = 'bbbbbbbb-0000-4000-8000-000000000002';
        $this->makeLesson($id, now()->addDays(3), 60);

        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->updateLesson($this->request('PUT', ['court_id' => self::COURT2_ID]), $id));
    }

    public function test_update_lesson_rejects_min_elo_above_max(): void
    {
        $id = 'bbbbbbbb-0000-4000-8000-000000000003';
        $this->makeLesson($id, now()->addDays(3), 60);

        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->updateLesson($this->request('PUT', ['level_min_elo' => 2000, 'level_max_elo' => 1000]), $id));
    }

    public function test_update_lesson_rejects_reschedule_into_past(): void
    {
        $id = 'bbbbbbbb-0000-4000-8000-000000000004';
        $this->makeLesson($id, now()->addDays(3), 60);

        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->updateLesson($this->request('PUT', ['starts_at' => now()->subHour()->toIso8601String()]), $id));
    }

    public function test_update_lesson_404_for_unknown_lesson(): void
    {
        $this->assertStatus(404, fn () => app(AdminLessonsController::class)
            ->updateLesson($this->request('PUT', ['title' => 'Renamed']), self::MISSING_UUID));
    }

    // ---- delete + roster -----------------------------------------------------

    public function test_delete_lesson_cancels_lesson_and_booked_players(): void
    {
        $id = 'cccccccc-0000-4000-8000-000000000001';
        $this->makeLesson($id, now()->addDays(3), 60);
        $this->booking('book-1', $id, self::PLAYER_ID, 'booked');

        $res = app(AdminLessonsController::class)->deleteLesson($this->request('DELETE', []), $id);

        $this->assertSame(204, $res->getStatusCode());
        $this->assertSame('cancelled', DB::table('lessons')->where('id', $id)->value('status'));
        $this->assertSame('cancelled', DB::table('lesson_bookings')->where('id', 'book-1')->value('status'));
    }

    public function test_roster_requires_staff(): void
    {
        $id = 'cccccccc-0000-4000-8000-000000000002';
        $this->makeLesson($id, now()->addDays(3), 60);

        $this->assertStatus(403, fn () => app(AdminLessonsController::class)
            ->roster($this->request('GET', [], self::PLAYER_ID), $id));
    }

    public function test_roster_lists_bookings_with_booked_count(): void
    {
        $id = 'cccccccc-0000-4000-8000-000000000003';
        $this->makeLesson($id, now()->addDays(3), 60);
        $this->booking('book-a', $id, self::PLAYER_ID, 'booked');
        $this->booking('book-b', $id, self::ADMIN_ID, 'cancelled');

        $data = app(AdminLessonsController::class)->roster($this->request('GET', []), $id)->getData(true);

        $this->assertCount(2, $data['items']);
        $this->assertSame(1, $data['booked_count']);
    }

    // ---- list filtering ------------------------------------------------------

    public function test_lessons_list_filters_by_status(): void
    {
        $this->makeLesson('dddddddd-0000-4000-8000-000000000001', now()->addDays(3), 60, 'scheduled');
        $this->makeLesson('dddddddd-0000-4000-8000-000000000002', now()->addDays(4), 60, 'cancelled');

        $data = app(AdminLessonsController::class)
            ->lessons($this->request('GET', ['status' => 'cancelled']))
            ->getData(true);

        $ids = array_column($data['items'], 'id');
        $this->assertSame(['dddddddd-0000-4000-8000-000000000002'], $ids);
    }

    public function test_lessons_list_rejects_bad_status_filter(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->lessons($this->request('GET', ['status' => 'bogus'])));
    }

    // ---- coaches -------------------------------------------------------------

    public function test_create_coach_requires_password_when_email_given(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createCoach($this->request('POST', [
                'venue_id' => self::VENUE_ID,
                'display_name' => 'Login Coach',
                'email' => 'newcoach@linkfit.az',
            ])));
    }

    public function test_create_coach_rejects_duplicate_email(): void
    {
        $this->assertStatus(409, fn () => app(AdminLessonsController::class)
            ->createCoach($this->request('POST', [
                'venue_id' => self::VENUE_ID,
                'display_name' => 'Dup Coach',
                'email' => 'admin@linkfit.az', // already registered
                'password' => 'StrongPassword123',
            ])));
    }

    public function test_create_coach_rejects_unknown_venue(): void
    {
        $this->assertStatus(422, fn () => app(AdminLessonsController::class)
            ->createCoach($this->request('POST', [
                'venue_id' => self::MISSING_UUID,
                'display_name' => 'Ghost Coach',
            ])));
    }

    // ---- helpers -------------------------------------------------------------

    private function basePayload(array $overrides = []): array
    {
        return array_merge([
            'venue_id' => self::VENUE_ID,
            'coach_id' => self::COACH_ID,
            'sport_id' => self::SPORT_ID,
            'court_id' => self::COURT_ID,
            'title' => 'Intro Padel',
            'kind' => 'group',
            'starts_at' => now()->addDays(5)->setTime(9, 0)->toIso8601String(),
            'duration_minutes' => 60,
            'capacity' => 4,
        ], $overrides);
    }

    private function makeLesson(string $id, \Carbon\CarbonInterface $startsAt, int $duration, string $status = 'scheduled'): void
    {
        DB::table('lessons')->insert([
            'id' => $id, 'coach_id' => self::COACH_ID, 'venue_id' => self::VENUE_ID,
            'court_id' => self::COURT_ID, 'sport_id' => self::SPORT_ID, 'title' => 'Lesson',
            'kind' => 'group', 'starts_at' => $startsAt, 'duration_minutes' => $duration,
            'capacity' => 4, 'currency' => 'AZN', 'status' => $status,
            'created_by' => self::ADMIN_ID, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function booking(string $id, string $lessonId, string $userId, string $status): void
    {
        DB::table('lesson_bookings')->insert([
            'id' => $id, 'lesson_id' => $lessonId, 'user_id' => $userId,
            'status' => $status, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function request(string $method, array $params, ?string $userId = self::ADMIN_ID): Request
    {
        $uri = '/api/v1/admin/lessons';
        $request = $method === 'GET'
            ? Request::create($uri, 'GET', $params)
            : Request::create($uri, $method, $params);
        if ($userId !== null) {
            $request->attributes->set('auth_user', User::query()->findOrFail($userId));
        }

        return $request;
    }

    private function assertStatus(int $expected, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$expected}.");
        } catch (ApiException $e) {
            $this->assertSame($expected, $e->getStatusCode());
        }
    }
}
