<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\VenueReviewsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Guards the review-eligibility gate on VenueReviewsController::store. Only a
 * user with a qualifying booking at the venue (paid, or a non-cancelled booking
 * whose slot has already started) may post/overwrite a venue review — this stops
 * review-bombing / fake ratings from users who never used the venue.
 *
 * Join path under test: bookings.user_id (owner) + bookings.court_id →
 * courts.venue_id (the venue being reviewed).
 */
class ReviewEligibilityTest extends TestCase
{
    private const REVIEWER = '00000000-0000-4000-8000-000000000501';

    private const SPORT = '00000000-0000-4000-8000-000000000502';

    private const VENUE = '00000000-0000-4000-8000-000000000503';

    private const COURT = '00000000-0000-4000-8000-000000000504';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
            $table->string('name');
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('status')->nullable();
            $table->decimal('rating_avg', 4, 2)->nullable();
            $table->integer('rating_count')->default(0);
            $table->timestamp('updated_at')->nullable();
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('sport_id');
            $table->string('name');
            $table->string('status')->nullable();
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('court_id');
            $table->string('user_id')->nullable();
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('duration_minutes');
            $table->string('status');
            $table->timestamps();
        });
        Schema::create('venue_reviews', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('author_user_id');
            $table->integer('rating');
            $table->text('body')->nullable();
            $table->string('photo_url')->nullable();
            $table->timestamp('removed_at')->nullable();
            $table->timestamps();
        });
        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->string('email')->nullable();
            $table->string('photo_url')->nullable();
        });

        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel', 'name' => 'Padel']);
        DB::table('venues')->insert(['id' => self::VENUE, 'name' => 'Venue', 'status' => 'published', 'rating_count' => 0]);
        DB::table('courts')->insert([
            'id' => self::COURT,
            'venue_id' => self::VENUE,
            'sport_id' => self::SPORT,
            'name' => 'Court 1',
            'status' => 'active',
        ]);
        DB::table('users')->insert([
            'id' => self::REVIEWER,
            'display_name' => 'Reviewer',
            'email' => 'reviewer@example.com',
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['venue_reviews', 'bookings', 'courts', 'venues', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_user_without_booking_cannot_review(): void
    {
        $threw = false;
        try {
            app(VenueReviewsController::class)->store($this->reviewRequest(['rating' => 5]), self::VENUE);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertTrue($threw, 'Expected a 403 forbidden when reviewing without a qualifying booking');
        $this->assertSame(0, DB::table('venue_reviews')->count());
    }

    public function test_user_with_only_cancelled_booking_cannot_review(): void
    {
        $this->seedBooking('cancelled', now()->subDay());

        $threw = false;
        try {
            app(VenueReviewsController::class)->store($this->reviewRequest(['rating' => 1]), self::VENUE);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertTrue($threw, 'Expected a 403 forbidden when only a cancelled booking exists');
        $this->assertSame(0, DB::table('venue_reviews')->count());
    }

    public function test_user_with_paid_booking_can_review_and_rating_updates(): void
    {
        // Paid but still upcoming → qualifies on the `paid` status alone.
        $this->seedBooking('paid', now()->addDay());

        $response = app(VenueReviewsController::class)->store($this->reviewRequest(['rating' => 4]), self::VENUE);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('venue_reviews')->where('venue_id', self::VENUE)->count());
        $venue = DB::table('venues')->where('id', self::VENUE)->first();
        $this->assertSame(4.0, (float) $venue->rating_avg);
        $this->assertSame(1, (int) $venue->rating_count);
    }

    public function test_user_with_past_booking_can_review(): void
    {
        // A non-cancelled booking whose slot has already started qualifies even
        // when it is not (yet) marked paid — pay-at-venue flow.
        $this->seedBooking('pending_payment', now()->subDay());

        $response = app(VenueReviewsController::class)->store($this->reviewRequest(['rating' => 5]), self::VENUE);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('venue_reviews')->where('venue_id', self::VENUE)->count());
    }

    private function seedBooking(string $status, \DateTimeInterface $startsAt): string
    {
        $id = (string) Str::uuid();
        DB::table('bookings')->insert([
            'id' => $id,
            'court_id' => self::COURT,
            'user_id' => self::REVIEWER,
            'starts_at' => $startsAt,
            'duration_minutes' => 60,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function reviewRequest(array $body = []): Request
    {
        $request = Request::create('/api/v1/venues/'.self::VENUE.'/reviews', 'POST', $body);
        $user = new User;
        $user->forceFill([
            'id' => self::REVIEWER,
            'admin_role' => null,
            'display_name' => 'Reviewer',
            'email' => 'reviewer@example.com',
        ]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
