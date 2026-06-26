<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\PartnerLessonsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Hardening coverage for the partner "Learn" management slice (coaches +
 * lessons): venue-scoped IDOR, the coach double-book guard, the ELO-range and
 * future-start validations, and the enrolment-release consistency rules — when a
 * coach is deactivated or a lesson is cancelled, every booked player must be
 * released rather than stranded on a cancelled lesson.
 *
 * Drives the controller directly with a synthetic Request (mirrors
 * LessonStaffCancelTest) so the in-controller authz/validation runs without the
 * JWT stack.
 */
class PartnerLessonsHardeningTest extends TestCase
{
    private const PARTNER_A = '00000000-0000-4000-8000-0000000000a1';

    private const PARTNER_B = '00000000-0000-4000-8000-0000000000b1';

    private const PLAYER_1 = '00000000-0000-4000-8000-000000000001';

    private const PLAYER_2 = '00000000-0000-4000-8000-000000000002';

    private const VENUE_A = '00000000-0000-4000-8000-0000000000aa';

    private const VENUE_B = '00000000-0000-4000-8000-0000000000bb';

    private const SPORT_ID = '00000000-0000-4000-8000-000000000020';

    private const COURT_A = '00000000-0000-4000-8000-0000000000ac';

    private const COACH_A = '00000000-0000-4000-8000-0000000000a3';

    private const COACH_B = '00000000-0000-4000-8000-0000000000b3';

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
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
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
        });
        Schema::create('coaches', function ($table): void {
            $table->string('id')->primary();
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
            ['id' => self::PARTNER_A, 'email' => 'a@linkfit.az', 'display_name' => 'Partner A', 'admin_role' => 'partner', 'venue_id' => self::VENUE_A, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PARTNER_B, 'email' => 'b@linkfit.az', 'display_name' => 'Partner B', 'admin_role' => 'partner', 'venue_id' => self::VENUE_B, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER_1, 'email' => 'p1@linkfit.az', 'display_name' => 'Player One', 'admin_role' => null, 'venue_id' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER_2, 'email' => 'p2@linkfit.az', 'display_name' => 'Player Two', 'admin_role' => null, 'venue_id' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT_ID, 'slug' => 'padel']);
        DB::table('venues')->insert([
            ['id' => self::VENUE_A, 'name' => 'Venue A'],
            ['id' => self::VENUE_B, 'name' => 'Venue B'],
        ]);
        DB::table('courts')->insert(['id' => self::COURT_A, 'venue_id' => self::VENUE_A, 'sport_id' => self::SPORT_ID, 'name' => 'Court A1']);
        DB::table('coaches')->insert([
            ['id' => self::COACH_A, 'venue_id' => self::VENUE_A, 'sport_id' => self::SPORT_ID, 'display_name' => 'Coach A', 'currency' => 'AZN', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::COACH_B, 'venue_id' => self::VENUE_B, 'sport_id' => self::SPORT_ID, 'display_name' => 'Coach B', 'currency' => 'AZN', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['lesson_bookings', 'lessons', 'coaches', 'courts', 'venues', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- createLesson --------------------------------------------------------

    public function test_create_lesson_happy_path(): void
    {
        $response = app(PartnerLessonsController::class)->createLesson($this->request(self::PARTNER_A, [
            'coach_id' => self::COACH_A,
            'sport_id' => self::SPORT_ID,
            'court_id' => self::COURT_A,
            'title' => 'Intro Padel',
            'starts_at' => now()->addDay()->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
        ]));

        $this->assertSame(201, $response->getStatusCode());
        $payload = $response->getData(true);
        $this->assertSame('Intro Padel', $payload['title']);
        $this->assertSame(1, DB::table('lessons')->where('venue_id', self::VENUE_A)->count());
    }

    public function test_create_lesson_rejects_inverted_elo_range(): void
    {
        $this->expectStatus(422, fn () => app(PartnerLessonsController::class)->createLesson($this->request(self::PARTNER_A, [
            'coach_id' => self::COACH_A,
            'sport_id' => self::SPORT_ID,
            'title' => 'Bad levels',
            'starts_at' => now()->addDay()->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
            'level_min_elo' => 2000,
            'level_max_elo' => 1000,
        ])));
    }

    public function test_create_lesson_rejects_past_start(): void
    {
        $this->expectStatus(422, fn () => app(PartnerLessonsController::class)->createLesson($this->request(self::PARTNER_A, [
            'coach_id' => self::COACH_A,
            'sport_id' => self::SPORT_ID,
            'title' => 'In the past',
            'starts_at' => now()->subHour()->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_create_lesson_rejects_coach_overlap(): void
    {
        $start = now()->addDays(2)->setTime(18, 0)->format('Y-m-d H:i:s');
        $this->seedLesson(self::COACH_A, self::VENUE_A, $start, 60);

        $this->expectStatus(409, fn () => app(PartnerLessonsController::class)->createLesson($this->request(self::PARTNER_A, [
            'coach_id' => self::COACH_A,
            'sport_id' => self::SPORT_ID,
            'title' => 'Overlapping',
            'starts_at' => now()->addDays(2)->setTime(18, 30)->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_create_lesson_rejects_coach_from_other_venue(): void
    {
        // Partner A may not schedule a lesson for a coach owned by venue B (IDOR).
        $this->expectStatus(404, fn () => app(PartnerLessonsController::class)->createLesson($this->request(self::PARTNER_A, [
            'coach_id' => self::COACH_B,
            'sport_id' => self::SPORT_ID,
            'title' => 'Cross-venue coach',
            'starts_at' => now()->addDay()->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
        ])));
    }

    public function test_create_lesson_rejects_court_from_other_venue(): void
    {
        $foreignCourt = '00000000-0000-4000-8000-0000000000bc';
        DB::table('courts')->insert(['id' => $foreignCourt, 'venue_id' => self::VENUE_B, 'sport_id' => self::SPORT_ID, 'name' => 'Court B1']);

        $this->expectStatus(422, fn () => app(PartnerLessonsController::class)->createLesson($this->request(self::PARTNER_A, [
            'coach_id' => self::COACH_A,
            'sport_id' => self::SPORT_ID,
            'court_id' => $foreignCourt,
            'title' => 'Cross-venue court',
            'starts_at' => now()->addDay()->format('Y-m-d H:i:s'),
            'duration_minutes' => 60,
        ])));
    }

    // ---- updateLesson --------------------------------------------------------

    public function test_update_lesson_cancel_releases_booked_players(): void
    {
        $lessonId = $this->seedLesson(self::COACH_A, self::VENUE_A, now()->addDays(3)->format('Y-m-d H:i:s'), 60);
        $bookedId = $this->seedBooking($lessonId, self::PLAYER_1, 'booked');
        $attendedId = $this->seedBooking($lessonId, self::PLAYER_2, 'attended');

        $response = app(PartnerLessonsController::class)->updateLesson($this->request(self::PARTNER_A, [
            'status' => 'cancelled',
        ]), $lessonId);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('lessons')->where('id', $lessonId)->value('status'));
        // The booked player is released; the already-attended row is untouched.
        $this->assertSame('cancelled', DB::table('lesson_bookings')->where('id', $bookedId)->value('status'));
        $this->assertSame('attended', DB::table('lesson_bookings')->where('id', $attendedId)->value('status'));
    }

    public function test_update_lesson_is_venue_scoped(): void
    {
        $lessonB = $this->seedLesson(self::COACH_B, self::VENUE_B, now()->addDays(3)->format('Y-m-d H:i:s'), 60);

        // Partner A must not be able to mutate a lesson owned by venue B (IDOR).
        $this->expectStatus(404, fn () => app(PartnerLessonsController::class)->updateLesson($this->request(self::PARTNER_A, [
            'title' => 'Hijacked',
        ]), $lessonB));

        $this->assertSame('Existing lesson', DB::table('lessons')->where('id', $lessonB)->value('title'));
    }

    public function test_update_lesson_rejects_coach_overlap(): void
    {
        $existing = $this->seedLesson(self::COACH_A, self::VENUE_A, now()->addDays(2)->setTime(18, 0)->format('Y-m-d H:i:s'), 60);
        $target = $this->seedLesson(self::COACH_A, self::VENUE_A, now()->addDays(2)->setTime(20, 0)->format('Y-m-d H:i:s'), 60);

        // Move $target on top of $existing → 409.
        $this->expectStatus(409, fn () => app(PartnerLessonsController::class)->updateLesson($this->request(self::PARTNER_A, [
            'starts_at' => now()->addDays(2)->setTime(18, 30)->format('Y-m-d H:i:s'),
        ]), $target));
    }

    // ---- deleteCoach ---------------------------------------------------------

    public function test_delete_coach_releases_players_and_cancels_future_lessons(): void
    {
        $future = $this->seedLesson(self::COACH_A, self::VENUE_A, now()->addDays(4)->format('Y-m-d H:i:s'), 60);
        $bookedId = $this->seedBooking($future, self::PLAYER_1, 'booked');

        $response = app(PartnerLessonsController::class)->deleteCoach($this->request(self::PARTNER_A, []), self::COACH_A);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame(0, (int) DB::table('coaches')->where('id', self::COACH_A)->value('is_active'));
        $this->assertSame('cancelled', DB::table('lessons')->where('id', $future)->value('status'));
        // The enrolled player is released rather than stranded on a cancelled lesson.
        $this->assertSame('cancelled', DB::table('lesson_bookings')->where('id', $bookedId)->value('status'));
    }

    public function test_delete_coach_is_venue_scoped(): void
    {
        $this->expectStatus(404, fn () => app(PartnerLessonsController::class)->deleteCoach($this->request(self::PARTNER_A, []), self::COACH_B));
        $this->assertSame(1, (int) DB::table('coaches')->where('id', self::COACH_B)->value('is_active'));
    }

    // ---- non-partner / no-venue gating --------------------------------------

    public function test_non_partner_user_is_forbidden(): void
    {
        $this->expectStatus(403, fn () => app(PartnerLessonsController::class)->coaches($this->request(self::PLAYER_1, [])));
    }

    // ---- helpers -------------------------------------------------------------

    private function expectStatus(int $status, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$status}.");
        } catch (ApiException $e) {
            $this->assertSame($status, $e->getStatusCode());
        }
    }

    private function seedLesson(string $coachId, string $venueId, string $startsAt, int $durationMinutes): string
    {
        $id = (string) Str::uuid();
        DB::table('lessons')->insert([
            'id' => $id,
            'coach_id' => $coachId,
            'venue_id' => $venueId,
            'court_id' => null,
            'sport_id' => self::SPORT_ID,
            'title' => 'Existing lesson',
            'kind' => 'group',
            'starts_at' => $startsAt,
            'duration_minutes' => $durationMinutes,
            'capacity' => 6,
            'currency' => 'AZN',
            'status' => 'scheduled',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function seedBooking(string $lessonId, string $userId, string $status): string
    {
        $id = (string) Str::uuid();
        DB::table('lesson_bookings')->insert([
            'id' => $id, 'lesson_id' => $lessonId, 'user_id' => $userId,
            'status' => $status, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function request(string $userId, array $body): Request
    {
        $request = Request::create('/api/v1/partner/lessons', 'POST', $body);
        $request->attributes->set('auth_user', User::query()->findOrFail($userId));

        return $request;
    }
}
