<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\WaitlistController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Waitlist consumer-endpoint hardening: ownership scoping (IDOR), validation/
 * conflict handling, idempotent re-join, and the per-user active cap. Exercises
 * {@see WaitlistController::create()}, {@see WaitlistController::cancel()} and
 * {@see WaitlistController::mine()} directly against an in-memory schema.
 */
class WaitlistHardeningTest extends TestCase
{
    private const USER_A = '00000000-0000-4000-8000-0000000b0001';

    private const USER_B = '00000000-0000-4000-8000-0000000b0002';

    private const SPORT = '00000000-0000-4000-8000-0000000b0003';

    private const VENUE = '00000000-0000-4000-8000-0000000b0004';

    private const COURT = '00000000-0000-4000-8000-0000000b0005';

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
            $table->string('owner_user_id')->nullable();
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('sport_id')->nullable();
            $table->string('name');
            $table->string('status')->nullable();
        });
        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('booking_waitlist_entries', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('court_id');
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('duration_minutes');
            $table->string('status')->default('active');
            $table->timestamp('notified_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'court_id', 'starts_at', 'duration_minutes']);
        });
        Schema::create('audit_log', function ($table): void {
            $table->string('id')->primary();
            $table->string('actor_user_id')->nullable();
            $table->string('action');
            $table->string('entity');
            $table->string('entity_id')->nullable();
            $table->text('metadata')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel', 'name' => 'Padel']);
        DB::table('venues')->insert(['id' => self::VENUE, 'name' => 'Venue', 'status' => 'published']);
        DB::table('courts')->insert(['id' => self::COURT, 'venue_id' => self::VENUE, 'sport_id' => self::SPORT, 'name' => 'Court 1', 'status' => 'active']);
        DB::table('users')->insert([
            ['id' => self::USER_A, 'email' => 'a@example.com', 'display_name' => 'Player A', 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::USER_B, 'email' => 'b@example.com', 'display_name' => 'Player B', 'created_at' => now(), 'updated_at' => now()],
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['audit_log', 'booking_waitlist_entries', 'users', 'courts', 'venues', 'sports'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    private function controller(): WaitlistController
    {
        return new WaitlistController;
    }

    private function request(string $method, array $params, string $authUserId): Request
    {
        $request = Request::create('/api/v1/waitlist', $method, $params);
        $request->attributes->set('auth_user', User::findOrFail($authUserId));

        return $request;
    }

    public function test_create_returns_201_with_active_entry_and_audit(): void
    {
        $startsAt = now()->addDays(2)->startOfHour()->toIso8601String();
        $response = $this->controller()->create(
            $this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 60], self::USER_A),
            self::COURT,
        );

        $this->assertSame(201, $response->getStatusCode());
        $body = $response->getData(true);
        $this->assertSame('active', $body['status']);
        $this->assertSame(self::USER_A, $body['user_id']);
        $this->assertSame(self::COURT, $body['court_id']);
        $this->assertSame(60, $body['duration_minutes']);
        $this->assertNotNull($body['ends_at']);

        $this->assertSame(1, DB::table('booking_waitlist_entries')->where('user_id', self::USER_A)->count());
        $this->assertSame(1, DB::table('audit_log')->where('action', 'waitlist.create')->count());
    }

    public function test_create_rejects_fully_elapsed_slot(): void
    {
        $startsAt = now()->subHours(3)->toIso8601String();
        try {
            $this->controller()->create(
                $this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 60], self::USER_A),
                self::COURT,
            );
            $this->fail('Expected a 409 for a past waitlist slot.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
        $this->assertSame(0, DB::table('booking_waitlist_entries')->count());
    }

    public function test_create_404_for_unknown_court(): void
    {
        try {
            $this->controller()->create(
                $this->request('POST', ['starts_at' => now()->addDay()->toIso8601String(), 'duration_minutes' => 60], self::USER_A),
                (string) Str::uuid(),
            );
            $this->fail('Expected a 404 for an unknown court.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_create_409_for_inactive_court(): void
    {
        DB::table('courts')->where('id', self::COURT)->update(['status' => 'maintenance']);
        try {
            $this->controller()->create(
                $this->request('POST', ['starts_at' => now()->addDay()->toIso8601String(), 'duration_minutes' => 60], self::USER_A),
                self::COURT,
            );
            $this->fail('Expected a 409 for an inactive court.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_create_validation_rejects_out_of_range_duration(): void
    {
        try {
            $this->controller()->create(
                $this->request('POST', ['starts_at' => now()->addDay()->toIso8601String(), 'duration_minutes' => 5], self::USER_A),
                self::COURT,
            );
            $this->fail('Expected a 422 for an out-of-range duration.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_create_twice_reactivates_existing_entry_without_duplicate(): void
    {
        $startsAt = now()->addDays(3)->startOfHour()->toIso8601String();
        $first = $this->controller()->create(
            $this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 90], self::USER_A),
            self::COURT,
        );
        $entryId = $first->getData(true)['id'];

        // Cancel it, then re-join the same slot — must reactivate the same row.
        DB::table('booking_waitlist_entries')->where('id', $entryId)->update(['status' => 'cancelled', 'cancelled_at' => now()]);

        $second = $this->controller()->create(
            $this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 90], self::USER_A),
            self::COURT,
        );

        $this->assertSame(201, $second->getStatusCode());
        $this->assertSame($entryId, $second->getData(true)['id']);
        $this->assertSame('active', $second->getData(true)['status']);
        $this->assertSame(1, DB::table('booking_waitlist_entries')->where('user_id', self::USER_A)->count());
        $this->assertSame(1, DB::table('audit_log')->where('action', 'waitlist.reactivate')->count());
    }

    public function test_cancel_marks_entry_cancelled(): void
    {
        $startsAt = now()->addDays(2)->startOfHour()->toIso8601String();
        $entryId = $this->controller()->create(
            $this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 60], self::USER_A),
            self::COURT,
        )->getData(true)['id'];

        $response = $this->controller()->cancel($this->request('DELETE', [], self::USER_A), $entryId);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('booking_waitlist_entries')->where('id', $entryId)->value('status'));
    }

    public function test_cancel_other_users_entry_is_not_found_and_untouched(): void
    {
        $startsAt = now()->addDays(2)->startOfHour()->toIso8601String();
        $entryId = $this->controller()->create(
            $this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 60], self::USER_A),
            self::COURT,
        )->getData(true)['id'];

        // User B must not be able to cancel User A's entry (IDOR).
        try {
            $this->controller()->cancel($this->request('DELETE', [], self::USER_B), $entryId);
            $this->fail('Expected a 404 when cancelling another user\'s entry.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
        $this->assertSame('active', DB::table('booking_waitlist_entries')->where('id', $entryId)->value('status'));
    }

    public function test_mine_only_returns_callers_entries(): void
    {
        $startsAt = now()->addDays(2)->startOfHour()->toIso8601String();
        $this->controller()->create($this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 60], self::USER_A), self::COURT);
        $this->controller()->create($this->request('POST', ['starts_at' => $startsAt, 'duration_minutes' => 60], self::USER_B), self::COURT);

        $body = $this->controller()->mine($this->request('GET', [], self::USER_A))->getData(true);

        $this->assertCount(1, $body['items']);
        $this->assertSame(self::USER_A, $body['items'][0]['user_id']);
    }

    public function test_active_entry_cap_is_enforced(): void
    {
        // Mirrors WaitlistController::MAX_ACTIVE_WAITLIST_ENTRIES (private const).
        $cap = 50;
        $rows = [];
        for ($i = 0; $i < $cap; $i++) {
            $rows[] = [
                'id' => (string) Str::uuid(),
                'user_id' => self::USER_A,
                'court_id' => self::COURT,
                'starts_at' => now()->addDays(10 + $i)->startOfHour(),
                'duration_minutes' => 60,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('booking_waitlist_entries')->insert($rows);

        try {
            $this->controller()->create(
                $this->request('POST', ['starts_at' => now()->addDays(500)->toIso8601String(), 'duration_minutes' => 60], self::USER_A),
                self::COURT,
            );
            $this->fail('Expected a 409 once the active waitlist cap is reached.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }
}
