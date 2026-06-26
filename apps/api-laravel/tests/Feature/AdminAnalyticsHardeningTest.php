<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminAnalyticsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the admin analytics dashboard reports: every endpoint
 * is staff-only (admin/moderator) and unauthenticated callers are rejected; the
 * portable reports (overview / engagement / funnel) compute correct aggregates.
 * Drives the controller directly with a synthetic Request over in-memory SQLite.
 * The growth/clubs reports use Postgres-only SQL (::date cast, FILTER) so only
 * their authorization is exercised here.
 */
class AdminAnalyticsHardeningTest extends TestCase
{
    private const U1 = '00000000-0000-4000-8000-0000000000a1';

    private const U2 = '00000000-0000-4000-8000-0000000000a2';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->boolean('is_vip')->default(false);
            $table->boolean('is_verified')->default(false);
            $table->string('referred_by_user_id')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('status');
        });
        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('match_type')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id')->nullable();
            $table->string('status');
            $table->integer('total_minor')->default(0);
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
        });
        Schema::create('coaches', function ($table): void {
            $table->string('id')->primary();
            $table->boolean('is_active')->default(true);
        });
        Schema::create('lessons', function ($table): void {
            $table->string('id')->primary();
        });
        Schema::create('lesson_bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('status');
            $table->timestamps();
        });
        Schema::create('game_participants', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('status');
            $table->timestamp('joined_at')->nullable();
        });
        Schema::create('messages', function ($table): void {
            $table->string('id')->primary();
            $table->timestamps();
        });
        Schema::create('follows', function ($table): void {
            $table->string('id')->primary();
            $table->timestamps();
        });

        DB::table('users')->insert([
            ['id' => self::U1, 'is_vip' => true, 'is_verified' => true, 'referred_by_user_id' => null, 'last_seen_at' => now(), 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::U2, 'is_vip' => false, 'is_verified' => false, 'referred_by_user_id' => self::U1, 'last_seen_at' => now(), 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('venues')->insert([
            ['id' => 'venue-1', 'status' => 'published'],
            ['id' => 'venue-2', 'status' => 'draft'],
        ]);
        DB::table('games')->insert([
            ['id' => 'game-1', 'match_type' => 'competitive', 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'game-2', 'match_type' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('bookings')->insert([
            ['id' => 'book-1', 'user_id' => self::U1, 'status' => 'confirmed', 'total_minor' => 5000, 'paid_at' => now(), 'created_at' => now(), 'updated_at' => now()],
            ['id' => 'book-2', 'user_id' => self::U2, 'status' => 'cancelled', 'total_minor' => 3000, 'paid_at' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('coaches')->insert(['id' => 'coach-1', 'is_active' => true]);
        DB::table('lessons')->insert(['id' => 'lesson-1']);
        DB::table('lesson_bookings')->insert(['id' => 'lb-1', 'status' => 'booked', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('game_participants')->insert([
            ['id' => 'gp-1', 'user_id' => self::U1, 'status' => 'confirmed', 'joined_at' => now()],
            ['id' => 'gp-2', 'user_id' => self::U2, 'status' => 'pending', 'joined_at' => now()],
        ]);
        DB::table('messages')->insert(['id' => 'msg-1', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('follows')->insert(['id' => 'follow-1', 'created_at' => now(), 'updated_at' => now()]);
    }

    protected function tearDown(): void
    {
        foreach (['follows', 'messages', 'game_participants', 'lesson_bookings', 'lessons', 'coaches', 'bookings', 'games', 'venues', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- authorization (all five endpoints) ---------------------------------

    private const ENDPOINTS = ['overview', 'growth', 'clubs', 'engagement', 'funnel'];

    public function test_every_endpoint_rejects_non_staff(): void
    {
        foreach (self::ENDPOINTS as $method) {
            $this->assertStatus(403, fn () => app(AdminAnalyticsController::class)
                ->{$method}($this->requestAs('player')), $method);
        }
    }

    public function test_every_endpoint_requires_authentication(): void
    {
        foreach (self::ENDPOINTS as $method) {
            $this->assertStatus(401, fn () => app(AdminAnalyticsController::class)
                ->{$method}($this->requestAs(null)), $method);
        }
    }

    public function test_moderator_is_allowed(): void
    {
        $res = app(AdminAnalyticsController::class)->overview($this->requestAs('moderator'));
        $this->assertSame(200, $res->getStatusCode());
    }

    // ---- portable report correctness ----------------------------------------

    public function test_overview_reports_expected_kpis(): void
    {
        $data = app(AdminAnalyticsController::class)->overview($this->requestAs('admin'))->getData(true);

        $this->assertSame('AZN', $data['currency']);
        $this->assertSame(2, $data['users']['total']);
        $this->assertSame(1, $data['users']['vip']);
        $this->assertSame(1, $data['users']['verified']);
        $this->assertSame(2, $data['users']['active_30d']);
        $this->assertSame(2, $data['venues']['total']);
        $this->assertSame(1, $data['venues']['active']);
        $this->assertSame(2, $data['games']['total']);
        $this->assertSame(2, $data['bookings']['total']);
        $this->assertSame(1, $data['bookings']['paid']);
        $this->assertSame(1, $data['bookings']['cancelled']);
        $this->assertSame(1, $data['learn']['coaches']);
        $this->assertSame(1, $data['learn']['lessons']);
        $this->assertSame(1, $data['learn']['lesson_bookings']);
        // gross excludes the cancelled booking; paid counts only collected money.
        $this->assertSame(5000, $data['revenue']['gross_booking_minor']);
        $this->assertSame(5000, $data['revenue']['paid_booking_minor']);
    }

    public function test_engagement_reports_expected_activity(): void
    {
        $data = app(AdminAnalyticsController::class)->engagement($this->requestAs('admin'))->getData(true);

        $this->assertSame(2, $data['games_created_30d']);
        $this->assertSame(2, $data['game_joins_30d']);
        $this->assertSame(1, $data['lesson_bookings_30d']);
        $this->assertSame(1, $data['messages_30d']);
        $this->assertSame(1, $data['follows_30d']);
        $this->assertSame(1, $data['follows_total']);
        // 1 confirmed participant / 2 games = 0.5
        $this->assertSame(0.5, $data['avg_participants_per_game']);

        $byType = collect($data['by_match_type'])->keyBy('match_type');
        $this->assertSame(1, (int) $byType['competitive']['count']);
        $this->assertSame(1, (int) $byType['casual']['count']); // null coalesced to 'casual'
    }

    public function test_funnel_reports_expected_stages(): void
    {
        $data = app(AdminAnalyticsController::class)->funnel($this->requestAs('admin'))->getData(true);

        $this->assertSame(2, $data['registered']);
        $this->assertSame(2, $data['played_a_game']);
        $this->assertSame(2, $data['booked_a_court']);
        $this->assertSame(1, $data['came_via_referral']);
    }

    // ---- helpers -------------------------------------------------------------

    private function requestAs(?string $role): Request
    {
        $request = Request::create('/api/v1/admin/analytics/overview', 'GET');
        if ($role !== null) {
            $user = new User;
            $user->forceFill(['id' => self::U1, 'admin_role' => $role === 'player' ? null : $role]);
            $request->attributes->set('auth_user', $user);
        }

        return $request;
    }

    private function assertStatus(int $expected, callable $fn, string $context = ''): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$expected}. {$context}");
        } catch (ApiException $e) {
            $this->assertSame($expected, $e->getStatusCode(), $context);
        }
    }
}
