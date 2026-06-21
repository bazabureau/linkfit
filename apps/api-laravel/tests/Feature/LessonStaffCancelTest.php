<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminLessonsController;
use App\Http\Controllers\Api\CoachPortalController;
use App\Http\Controllers\Api\PartnerLessonsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Staff-side lesson cancellation must release enrolled players: when a lesson is
 * cancelled by a coach / partner / admin, its `booked` lesson_bookings rows must
 * flip to `cancelled` (problem #1). Also covers the coach double-book guard
 * (problem #2) on lesson creation.
 */
class LessonStaffCancelTest extends TestCase
{
    private const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

    private const PLAYER_ID = '00000000-0000-4000-8000-000000000002';

    private const PLAYER2_ID = '00000000-0000-4000-8000-000000000003';

    private const PARTNER_ID = '00000000-0000-4000-8000-000000000004';

    private const COACH_USER_ID = '00000000-0000-4000-8000-000000000005';

    private const VENUE_ID = '00000000-0000-4000-8000-000000000010';

    private const COURT_ID = '00000000-0000-4000-8000-000000000011';

    private const SPORT_ID = '00000000-0000-4000-8000-000000000020';

    private const COACH_ID = '00000000-0000-4000-8000-000000000030';

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
            $table->string('venue_id')->nullable();
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
            ['id' => self::ADMIN_ID, 'email' => 'admin@linkfit.az', 'display_name' => 'Admin', 'admin_role' => 'admin', 'venue_id' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER_ID, 'email' => 'player@linkfit.az', 'display_name' => 'Player', 'admin_role' => null, 'venue_id' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER2_ID, 'email' => 'player2@linkfit.az', 'display_name' => 'Player Two', 'admin_role' => null, 'venue_id' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PARTNER_ID, 'email' => 'partner@linkfit.az', 'display_name' => 'Partner', 'admin_role' => 'partner', 'venue_id' => self::VENUE_ID, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::COACH_USER_ID, 'email' => 'coach@linkfit.az', 'display_name' => 'Coach', 'admin_role' => 'coach', 'venue_id' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT_ID, 'slug' => 'padel']);
        DB::table('venues')->insert(['id' => self::VENUE_ID, 'name' => 'LinkFit Arena']);
        DB::table('courts')->insert([
            'id' => self::COURT_ID,
            'venue_id' => self::VENUE_ID,
            'sport_id' => self::SPORT_ID,
            'name' => 'Court 1',
            'status' => 'active',
        ]);
        DB::table('coaches')->insert([
            'id' => self::COACH_ID,
            'user_id' => self::COACH_USER_ID,
            'venue_id' => self::VENUE_ID,
            'sport_id' => self::SPORT_ID,
            'display_name' => 'Coach',
            'currency' => 'AZN',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['lesson_bookings', 'lessons', 'coaches', 'courts', 'venues', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_admin_cancel_releases_booked_enrollments(): void
    {
        [$lessonId, $bookedId, $attendedId] = $this->seedLessonWithBookings();

        $response = app(AdminLessonsController::class)->deleteLesson($this->requestAs(self::ADMIN_ID), $lessonId);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('lessons')->where('id', $lessonId)->value('status'));
        // The booked enrollment is released...
        $this->assertSame('cancelled', DB::table('lesson_bookings')->where('id', $bookedId)->value('status'));
        // ...but a non-booked (already attended) enrollment is left untouched.
        $this->assertSame('attended', DB::table('lesson_bookings')->where('id', $attendedId)->value('status'));
    }

    public function test_partner_cancel_releases_booked_enrollments(): void
    {
        [$lessonId, $bookedId] = $this->seedLessonWithBookings();

        $response = app(PartnerLessonsController::class)->deleteLesson($this->requestAs(self::PARTNER_ID), $lessonId);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('lessons')->where('id', $lessonId)->value('status'));
        $this->assertSame('cancelled', DB::table('lesson_bookings')->where('id', $bookedId)->value('status'));
    }

    public function test_coach_cancel_releases_booked_enrollments(): void
    {
        [$lessonId, $bookedId] = $this->seedLessonWithBookings();

        $response = app(CoachPortalController::class)->cancelLesson($this->requestAs(self::COACH_USER_ID), $lessonId);
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('cancelled', $payload['status']);
        $this->assertSame('cancelled', DB::table('lesson_bookings')->where('id', $bookedId)->value('status'));
    }

    public function test_coach_create_overlapping_lesson_is_rejected(): void
    {
        $startsAt = now()->addDays(2)->setTime(18, 0)->format('Y-m-d H:i:s');
        $this->seedLesson($startsAt, 60);

        // Overlaps the existing 18:00-19:00 lesson (starts at 18:30).
        $overlapStart = now()->addDays(2)->setTime(18, 30)->format('Y-m-d H:i:s');

        try {
            app(CoachPortalController::class)->createLesson($this->requestAs(self::COACH_USER_ID, [
                'title' => 'Overlapping lesson',
                'kind' => 'group',
                'starts_at' => $overlapStart,
                'duration_minutes' => 60,
            ]));
            $this->fail('Expected overlapping lesson creation to be rejected');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_coach_create_non_overlapping_lesson_is_allowed(): void
    {
        $startsAt = now()->addDays(2)->setTime(18, 0)->format('Y-m-d H:i:s');
        $this->seedLesson($startsAt, 60);

        // Starts right after the existing 18:00-19:00 lesson ends.
        $nextStart = now()->addDays(2)->setTime(19, 0)->format('Y-m-d H:i:s');

        $response = app(CoachPortalController::class)->createLesson($this->requestAs(self::COACH_USER_ID, [
            'title' => 'Back-to-back lesson',
            'kind' => 'group',
            'starts_at' => $nextStart,
            'duration_minutes' => 60,
        ]));

        $this->assertSame(201, $response->getStatusCode());
    }

    /**
     * Seed a scheduled lesson with one `booked` and one `attended` enrollment.
     *
     * @return array{0:string,1:string,2:string} [lessonId, bookedBookingId, attendedBookingId]
     */
    private function seedLessonWithBookings(): array
    {
        $lessonId = $this->seedLesson(now()->addDays(3)->format('Y-m-d H:i:s'), 60);
        $bookedId = (string) Str::uuid();
        $attendedId = (string) Str::uuid();
        DB::table('lesson_bookings')->insert([
            ['id' => $bookedId, 'lesson_id' => $lessonId, 'user_id' => self::PLAYER_ID, 'status' => 'booked', 'created_at' => now(), 'updated_at' => now()],
            ['id' => $attendedId, 'lesson_id' => $lessonId, 'user_id' => self::PLAYER2_ID, 'status' => 'attended', 'created_at' => now(), 'updated_at' => now()],
        ]);

        return [$lessonId, $bookedId, $attendedId];
    }

    private function seedLesson(string $startsAt, int $durationMinutes): string
    {
        $id = (string) Str::uuid();
        DB::table('lessons')->insert([
            'id' => $id,
            'coach_id' => self::COACH_ID,
            'venue_id' => self::VENUE_ID,
            'court_id' => self::COURT_ID,
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

    private function requestAs(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/staff/lessons', 'POST', $body);
        $request->attributes->set('auth_user', User::query()->findOrFail($userId));

        return $request;
    }
}
