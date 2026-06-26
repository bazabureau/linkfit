<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\CoachPortalController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Authorization (IDOR), validation, overlap-race and cancel-release behaviour of
 * the coach portal. Complements CoachPortalControllerTest (admin->coach bootstrap).
 */
class CoachPortalHardeningTest extends TestCase
{
    private const COACH_A_USER = '00000000-0000-4000-8000-00000000a001';
    private const COACH_B_USER = '00000000-0000-4000-8000-00000000a002';
    private const PLAYER_ID = '00000000-0000-4000-8000-00000000a003';
    private const COACH_A_ID = '00000000-0000-4000-8000-00000000c001';
    private const COACH_B_ID = '00000000-0000-4000-8000-00000000c002';
    private const VENUE_ID = '00000000-0000-4000-8000-00000000d001';
    private const OTHER_VENUE_ID = '00000000-0000-4000-8000-00000000d002';
    private const COURT_ID = '00000000-0000-4000-8000-00000000e001';
    private const OTHER_COURT_ID = '00000000-0000-4000-8000-00000000e002';
    private const SPORT_ID = '00000000-0000-4000-8000-00000000f001';

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
            ['id' => self::COACH_A_USER, 'email' => 'coacha@linkfit.az', 'display_name' => 'Coach A', 'admin_role' => 'coach', 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::COACH_B_USER, 'email' => 'coachb@linkfit.az', 'display_name' => 'Coach B', 'admin_role' => 'coach', 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER_ID, 'email' => 'player@linkfit.az', 'display_name' => 'Player', 'admin_role' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT_ID, 'slug' => 'padel']);
        DB::table('venues')->insert([
            ['id' => self::VENUE_ID, 'name' => 'LinkFit Arena'],
            ['id' => self::OTHER_VENUE_ID, 'name' => 'Other Arena'],
        ]);
        DB::table('courts')->insert([
            ['id' => self::COURT_ID, 'venue_id' => self::VENUE_ID, 'sport_id' => self::SPORT_ID, 'name' => 'Court 1', 'status' => 'active'],
            ['id' => self::OTHER_COURT_ID, 'venue_id' => self::OTHER_VENUE_ID, 'sport_id' => self::SPORT_ID, 'name' => 'Court X', 'status' => 'active'],
        ]);
        DB::table('coaches')->insert([
            ['id' => self::COACH_A_ID, 'user_id' => self::COACH_A_USER, 'venue_id' => self::VENUE_ID, 'sport_id' => self::SPORT_ID, 'display_name' => 'Coach A', 'currency' => 'AZN', 'hourly_rate_minor' => 4000, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::COACH_B_ID, 'user_id' => self::COACH_B_USER, 'venue_id' => self::VENUE_ID, 'sport_id' => self::SPORT_ID, 'display_name' => 'Coach B', 'currency' => 'AZN', 'hourly_rate_minor' => 4000, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['lesson_bookings', 'lessons', 'coaches', 'courts', 'venues', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_coach_can_create_lesson(): void
    {
        $response = $this->controller()->createLesson($this->actAs(self::COACH_A_USER, 'POST', [
            'title' => 'Morning padel',
            'starts_at' => $this->futureAt('10:00'),
            'duration_minutes' => 60,
        ]));

        $this->assertSame(201, $response->getStatusCode());
        $payload = $response->getData(true);
        $this->assertSame('Morning padel', $payload['title']);
        $this->assertSame('group', $payload['kind']);
        $this->assertDatabaseHas('lessons', ['coach_id' => self::COACH_A_ID, 'title' => 'Morning padel']);
    }

    public function test_overlapping_lesson_is_rejected_with_conflict(): void
    {
        $this->controller()->createLesson($this->actAs(self::COACH_A_USER, 'POST', [
            'title' => 'First',
            'starts_at' => $this->futureAt('10:00'),
            'duration_minutes' => 60,
        ]));

        $this->assertApiStatus(409, fn () => $this->controller()->createLesson($this->actAs(self::COACH_A_USER, 'POST', [
            'title' => 'Overlapping',
            'starts_at' => $this->futureAt('10:30'),
            'duration_minutes' => 60,
        ])));

        // Only the first lesson should have been persisted (transaction rolled back).
        $this->assertSame(1, (int) DB::table('lessons')->where('coach_id', self::COACH_A_ID)->count());
    }

    public function test_create_lesson_in_the_past_is_rejected(): void
    {
        $this->assertApiStatus(422, fn () => $this->controller()->createLesson($this->actAs(self::COACH_A_USER, 'POST', [
            'title' => 'Yesterday',
            'starts_at' => now()->subDay()->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_cannot_attach_court_from_another_venue(): void
    {
        $this->assertApiStatus(422, fn () => $this->controller()->createLesson($this->actAs(self::COACH_A_USER, 'POST', [
            'title' => 'Cross-venue court',
            'court_id' => self::OTHER_COURT_ID,
            'starts_at' => $this->futureAt('14:00'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_private_lesson_must_have_capacity_one(): void
    {
        $this->assertApiStatus(422, fn () => $this->controller()->createLesson($this->actAs(self::COACH_A_USER, 'POST', [
            'title' => 'Private',
            'kind' => 'private',
            'capacity' => 4,
            'starts_at' => $this->futureAt('15:00'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_non_coach_user_cannot_create_lesson(): void
    {
        $this->assertApiStatus(403, fn () => $this->controller()->createLesson($this->actAs(self::PLAYER_ID, 'POST', [
            'title' => 'Nope',
            'starts_at' => $this->futureAt('16:00'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_coach_cannot_update_another_coachs_lesson(): void
    {
        $lessonId = '00000000-0000-4000-8000-0000000aa001';
        $this->insertLesson($lessonId, self::COACH_A_ID, $this->futureAt('10:00'));

        $this->assertApiStatus(404, fn () => $this->controller()->updateLesson(
            $this->actAs(self::COACH_B_USER, 'PATCH', ['title' => 'Hijacked']),
            $lessonId,
        ));
        $this->assertDatabaseHas('lessons', ['id' => $lessonId, 'title' => 'Lesson']);
    }

    public function test_coach_cannot_cancel_another_coachs_lesson(): void
    {
        $lessonId = '00000000-0000-4000-8000-0000000aa002';
        $this->insertLesson($lessonId, self::COACH_A_ID, $this->futureAt('11:00'));

        $this->assertApiStatus(404, fn () => $this->controller()->cancelLesson(
            $this->actAs(self::COACH_B_USER, 'POST'),
            $lessonId,
        ));
        $this->assertDatabaseHas('lessons', ['id' => $lessonId, 'status' => 'scheduled']);
    }

    public function test_coach_cannot_view_another_coachs_roster(): void
    {
        $lessonId = '00000000-0000-4000-8000-0000000aa003';
        $this->insertLesson($lessonId, self::COACH_A_ID, $this->futureAt('12:00'));

        $this->assertApiStatus(404, fn () => $this->controller()->roster(
            $this->actAs(self::COACH_B_USER, 'GET'),
            $lessonId,
        ));
    }

    public function test_cancel_lesson_releases_booked_players(): void
    {
        $lessonId = '00000000-0000-4000-8000-0000000aa004';
        $this->insertLesson($lessonId, self::COACH_A_ID, $this->futureAt('13:00'));
        DB::table('lesson_bookings')->insert([
            'id' => '00000000-0000-4000-8000-0000000bb001',
            'lesson_id' => $lessonId,
            'user_id' => self::PLAYER_ID,
            'status' => 'booked',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->controller()->cancelLesson($this->actAs(self::COACH_A_USER, 'POST'), $lessonId);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertDatabaseHas('lessons', ['id' => $lessonId, 'status' => 'cancelled']);
        $this->assertDatabaseHas('lesson_bookings', ['lesson_id' => $lessonId, 'status' => 'cancelled']);
    }

    public function test_update_capacity_below_current_bookings_is_rejected(): void
    {
        $lessonId = '00000000-0000-4000-8000-0000000aa005';
        $this->insertLesson($lessonId, self::COACH_A_ID, $this->futureAt('17:00'), 60, 4);
        DB::table('lesson_bookings')->insert([
            ['id' => '00000000-0000-4000-8000-0000000bb010', 'lesson_id' => $lessonId, 'user_id' => self::PLAYER_ID, 'status' => 'booked', 'created_at' => now(), 'updated_at' => now()],
            ['id' => '00000000-0000-4000-8000-0000000bb011', 'lesson_id' => $lessonId, 'user_id' => self::COACH_B_USER, 'status' => 'booked', 'created_at' => now(), 'updated_at' => now()],
        ]);

        $this->assertApiStatus(422, fn () => $this->controller()->updateLesson(
            $this->actAs(self::COACH_A_USER, 'PATCH', ['capacity' => 1]),
            $lessonId,
        ));
    }

    private function controller(): CoachPortalController
    {
        return app(CoachPortalController::class);
    }

    private function insertLesson(string $id, string $coachId, string $startsAt, int $duration = 60, int $capacity = 4, string $status = 'scheduled'): void
    {
        DB::table('lessons')->insert([
            'id' => $id,
            'coach_id' => $coachId,
            'venue_id' => self::VENUE_ID,
            'court_id' => null,
            'sport_id' => self::SPORT_ID,
            'title' => 'Lesson',
            'kind' => 'group',
            'starts_at' => $startsAt,
            'duration_minutes' => $duration,
            'capacity' => $capacity,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function futureAt(string $time): string
    {
        return now()->addDays(2)->format('Y-m-d').' '.$time.':00';
    }

    private function actAs(string $userId, string $method, array $body = []): Request
    {
        $request = Request::create('/api/v1/coach/lessons', $method, $body);
        $request->attributes->set('auth_user', User::query()->findOrFail($userId));

        return $request;
    }

    private function assertApiStatus(int $expected, callable $fn): void
    {
        try {
            $fn();
            $this->fail('Expected ApiException with status '.$expected.' but none was thrown');
        } catch (ApiException $e) {
            $this->assertSame($expected, $e->getStatusCode());
        }
    }
}
