<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\LessonsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the "Learn" slice (lessons / coaches): authorization on
 * the player book/cancel/mine actions, IDOR scoping, capacity/double-book races,
 * status + time-window guards, and the public-browse input validation.
 *
 * Drives the controller directly with a synthetic Request (mirrors
 * CatalogHardeningTest) so in-controller authz/validation runs without the JWT
 * stack. A SQLite `now()` UDF is registered so mine()'s `orderByRaw(... now())`
 * (raw SQL, Postgres in prod) is exercisable in-memory.
 */
class LessonsHardeningTest extends TestCase
{
    private const ALICE = '00000000-0000-4000-8000-0000000000a1';

    private const BOB = '00000000-0000-4000-8000-0000000000b2';

    private const COACH_ID = '11111111-1111-4111-8111-111111111111';

    private const LESSON_OPEN = '22222222-2222-4222-8222-222222222222';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');
        // mine() orders via `orderByRaw('l.starts_at >= now() desc')` — register a
        // SQLite UDF so the raw SQL now() resolves in-memory like Postgres' now().
        DB::connection('sqlite')->getPdo()->sqliteCreateFunction('now', fn () => now()->toDateTimeString(), 0);

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->timestamp('deleted_at')->nullable();
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
            $table->string('name');
        });
        Schema::create('coaches', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->text('bio')->nullable();
            $table->float('rating')->nullable();
            $table->integer('years_experience')->nullable();
            $table->integer('hourly_rate_minor')->nullable();
            $table->string('currency')->nullable();
            $table->string('sport_id')->nullable();
            $table->string('venue_id')->nullable();
            $table->boolean('is_active')->default(true);
        });
        Schema::create('lessons', function ($table): void {
            $table->string('id')->primary();
            $table->string('coach_id');
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
            $table->string('venue_id')->nullable();
            $table->string('court_id')->nullable();
            $table->string('sport_id')->nullable();
        });
        Schema::create('lesson_bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('lesson_id');
            $table->string('user_id');
            $table->string('status');
            $table->timestamps();
        });

        DB::table('users')->insert([
            ['id' => self::ALICE, 'display_name' => 'Alice', 'photo_url' => null],
            ['id' => self::BOB, 'display_name' => 'Bob', 'photo_url' => null],
        ]);
        DB::table('sports')->insert(['id' => 'sport-1', 'slug' => 'padel']);
        DB::table('venues')->insert(['id' => 'venue-1', 'name' => 'LinkFit Court']);
        DB::table('courts')->insert(['id' => 'court-1', 'name' => 'Court 1']);
        DB::table('coaches')->insert([
            'id' => self::COACH_ID, 'display_name' => 'Coach One', 'photo_url' => null,
            'bio' => 'Padel coach', 'rating' => 4.8, 'years_experience' => 7,
            'hourly_rate_minor' => 9000, 'currency' => 'AZN', 'sport_id' => 'sport-1',
            'venue_id' => 'venue-1', 'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('lesson_bookings');
        Schema::dropIfExists('lessons');
        Schema::dropIfExists('coaches');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    // ---- index / show input validation --------------------------------------

    public function test_index_rejects_impossible_calendar_date(): void
    {
        try {
            app(LessonsController::class)->index($this->request(null, '/api/v1/lessons', ['date' => '2026-13-45']));
            $this->fail('Expected 422 for an impossible calendar date.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_index_rejects_malformed_venue_id(): void
    {
        try {
            app(LessonsController::class)->index($this->request(null, '/api/v1/lessons', ['venue_id' => 'not-a-uuid']));
            $this->fail('Expected 422 for a malformed venue_id.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_index_lists_future_scheduled_and_marks_viewer_booking(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), capacity: 4);
        // A past lesson and a cancelled future lesson must NOT appear.
        $this->makeLesson('33333333-3333-4333-8333-333333333333', now()->subDay());
        $this->makeLesson('44444444-4444-4444-8444-444444444444', now()->addDay(), status: 'cancelled');
        $this->booking(self::ALICE, self::LESSON_OPEN, 'booked');

        $data = app(LessonsController::class)
            ->index($this->request(self::ALICE, '/api/v1/lessons'))
            ->getData(true);

        $ids = array_column($data['items'], 'id');
        $this->assertContains(self::LESSON_OPEN, $ids);
        $this->assertNotContains('33333333-3333-4333-8333-333333333333', $ids);
        $this->assertNotContains('44444444-4444-4444-8444-444444444444', $ids);

        $row = collect($data['items'])->firstWhere('id', self::LESSON_OPEN);
        $this->assertTrue($row['is_booked_by_me']);
        $this->assertTrue($row['is_booked']);
        $this->assertSame(1, $row['booked_count']);
        $this->assertSame(3, $row['spots_left']);
    }

    public function test_index_does_not_mark_booking_for_anonymous_viewer(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay());
        $this->booking(self::ALICE, self::LESSON_OPEN, 'booked');

        $data = app(LessonsController::class)
            ->index($this->request(null, '/api/v1/lessons'))
            ->getData(true);

        $row = collect($data['items'])->firstWhere('id', self::LESSON_OPEN);
        $this->assertFalse($row['is_booked_by_me']);
    }

    public function test_show_rejects_malformed_id(): void
    {
        try {
            app(LessonsController::class)->show($this->request(null, '/api/v1/lessons/x'), 'garbage');
            $this->fail('Expected 404 for a malformed lesson id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_show_returns_404_for_unknown_lesson(): void
    {
        try {
            app(LessonsController::class)->show($this->request(null, '/api/v1/lessons/x'), '99999999-9999-4999-8999-999999999999');
            $this->fail('Expected 404 for an unknown lesson.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_show_includes_coach_and_booked_participants_only(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay());
        $this->booking(self::ALICE, self::LESSON_OPEN, 'booked');
        $this->booking(self::BOB, self::LESSON_OPEN, 'cancelled');

        $data = app(LessonsController::class)
            ->show($this->request(null, '/api/v1/lessons/x'), self::LESSON_OPEN)
            ->getData(true);

        $this->assertSame(self::COACH_ID, $data['coach']['id']);
        $participantIds = array_column($data['participants'], 'id');
        // Only the actively-booked participant is listed; the cancelled one is hidden.
        $this->assertSame([self::ALICE], $participantIds);
    }

    // ---- book ----------------------------------------------------------------

    public function test_book_requires_authentication(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay());
        try {
            app(LessonsController::class)->book($this->request(null, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN);
            $this->fail('Expected 401 for an unauthenticated booking.');
        } catch (ApiException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }
    }

    public function test_book_rejects_malformed_id(): void
    {
        try {
            app(LessonsController::class)->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), 'garbage');
            $this->fail('Expected 404 for a malformed lesson id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_book_404_for_unknown_lesson(): void
    {
        try {
            app(LessonsController::class)->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), '99999999-9999-4999-8999-999999999999');
            $this->fail('Expected 404 for an unknown lesson.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_book_happy_path_enrolls_and_reports_spots_left(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), capacity: 4);

        $data = app(LessonsController::class)
            ->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN)
            ->getData(true);

        $this->assertTrue($data['ok']);
        $this->assertSame(3, $data['spots_left']);
        $this->assertSame(1, DB::table('lesson_bookings')
            ->where('lesson_id', self::LESSON_OPEN)->where('user_id', self::ALICE)->where('status', 'booked')->count());
    }

    public function test_book_is_idempotent_when_already_booked(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), capacity: 4);
        $this->booking(self::ALICE, self::LESSON_OPEN, 'booked');

        $data = app(LessonsController::class)
            ->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN)
            ->getData(true);

        $this->assertTrue($data['already_booked']);
        // No duplicate row created.
        $this->assertSame(1, DB::table('lesson_bookings')
            ->where('lesson_id', self::LESSON_OPEN)->where('user_id', self::ALICE)->count());
    }

    public function test_book_rejects_when_full(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), capacity: 1);
        $this->booking(self::BOB, self::LESSON_OPEN, 'booked');

        try {
            app(LessonsController::class)->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN);
            $this->fail('Expected 409 when the lesson is full.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
        $this->assertSame(0, DB::table('lesson_bookings')->where('user_id', self::ALICE)->count());
    }

    public function test_book_rejects_non_scheduled_lesson(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), status: 'cancelled');
        try {
            app(LessonsController::class)->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN);
            $this->fail('Expected 409 for a non-scheduled lesson.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_book_rejects_already_started_lesson(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->subHour());
        try {
            app(LessonsController::class)->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN);
            $this->fail('Expected 409 for an already-started lesson.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_rebooking_a_cancelled_enrollment_reactivates_same_row(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), capacity: 4);
        $this->booking(self::ALICE, self::LESSON_OPEN, 'cancelled');

        app(LessonsController::class)->book($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'POST'), self::LESSON_OPEN);

        $this->assertSame(1, DB::table('lesson_bookings')->where('user_id', self::ALICE)->count());
        $this->assertSame('booked', DB::table('lesson_bookings')->where('user_id', self::ALICE)->value('status'));
    }

    // ---- cancel --------------------------------------------------------------

    public function test_cancel_requires_authentication(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay());
        try {
            app(LessonsController::class)->cancel($this->request(null, '/api/v1/lessons/x/book', [], 'DELETE'), self::LESSON_OPEN);
            $this->fail('Expected 401 for an unauthenticated cancel.');
        } catch (ApiException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }
    }

    public function test_cancel_rejects_when_not_booked(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay());
        try {
            app(LessonsController::class)->cancel($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'DELETE'), self::LESSON_OPEN);
            $this->fail('Expected 409 when the caller has no active booking.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_cancel_is_scoped_to_the_caller_only(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay(), capacity: 4);
        $this->booking(self::ALICE, self::LESSON_OPEN, 'booked');
        $this->booking(self::BOB, self::LESSON_OPEN, 'booked');

        $response = app(LessonsController::class)
            ->cancel($this->request(self::ALICE, '/api/v1/lessons/x/book', [], 'DELETE'), self::LESSON_OPEN);

        $this->assertSame(204, $response->getStatusCode());
        // Alice's row cancelled; Bob's enrollment is untouched (no cross-user IDOR).
        $this->assertSame('cancelled', DB::table('lesson_bookings')
            ->where('lesson_id', self::LESSON_OPEN)->where('user_id', self::ALICE)->value('status'));
        $this->assertSame('booked', DB::table('lesson_bookings')
            ->where('lesson_id', self::LESSON_OPEN)->where('user_id', self::BOB)->value('status'));
    }

    // ---- mine ----------------------------------------------------------------

    public function test_mine_requires_authentication(): void
    {
        try {
            app(LessonsController::class)->mine($this->request(null, '/api/v1/me/lessons'));
            $this->fail('Expected 401 for an unauthenticated mine().');
        } catch (ApiException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }
    }

    public function test_mine_returns_only_callers_active_bookings(): void
    {
        $this->makeLesson(self::LESSON_OPEN, now()->addDay());
        $other = '55555555-5555-4555-8555-555555555555';
        $this->makeLesson($other, now()->addDay());

        $this->booking(self::ALICE, self::LESSON_OPEN, 'booked');
        $this->booking(self::ALICE, $other, 'cancelled');   // cancelled → excluded
        $this->booking(self::BOB, self::LESSON_OPEN, 'booked'); // other user → excluded

        $data = app(LessonsController::class)
            ->mine($this->request(self::ALICE, '/api/v1/me/lessons'))
            ->getData(true);

        $ids = array_column($data['items'], 'id');
        $this->assertSame([self::LESSON_OPEN], $ids);
        $this->assertTrue($data['items'][0]['is_booked_by_me']);
    }

    // ---- helpers -------------------------------------------------------------

    private function makeLesson(string $id, \Carbon\CarbonInterface $startsAt, string $status = 'scheduled', int $capacity = 4): void
    {
        DB::table('lessons')->insert([
            'id' => $id, 'coach_id' => self::COACH_ID, 'title' => 'Intro Padel',
            'description' => 'Drills', 'kind' => 'group', 'level_label' => 'Beginner',
            'level_min_elo' => null, 'level_max_elo' => null, 'starts_at' => $startsAt,
            'duration_minutes' => 60, 'capacity' => $capacity, 'price_minor' => 5000,
            'currency' => 'AZN', 'status' => $status, 'venue_id' => 'venue-1',
            'court_id' => 'court-1', 'sport_id' => 'sport-1',
        ]);
    }

    private function booking(string $userId, string $lessonId, string $status): void
    {
        DB::table('lesson_bookings')->insert([
            'id' => $userId.'-'.$lessonId, 'lesson_id' => $lessonId, 'user_id' => $userId,
            'status' => $status, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function request(?string $userId, string $uri, array $params = [], string $method = 'GET'): Request
    {
        $request = Request::create($uri, $method, $params);
        if ($userId !== null) {
            $user = new User;
            $user->forceFill(['id' => $userId]);
            $request->attributes->set('auth_user', $user);
        }

        return $request;
    }
}
