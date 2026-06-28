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
 * #6 — the revenue-bearing admin analytics reports are gated by the grantable
 * 'reports' permission (like AdminOps), not by role alone. A moderator whose
 * 'reports' permission is explicitly revoked is forbidden from every endpoint;
 * a moderator who holds it (the default) and a full admin are allowed.
 */
class AdminAnalyticsPermissionTest extends TestCase
{
    private const ENDPOINTS = ['overview', 'growth', 'clubs', 'engagement', 'funnel'];

    private const UID = '00000000-0000-4000-8000-0000000000c1';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        // overview() (the portable, sqlite-friendly report) touches these tables;
        // empty tables are fine — we only assert the authorization outcome.
        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->boolean('is_vip')->default(false);
            $table->boolean('is_verified')->default(false);
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
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
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
    }

    protected function tearDown(): void
    {
        foreach (['lesson_bookings', 'lessons', 'coaches', 'bookings', 'games', 'venues', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_moderator_without_reports_permission_is_forbidden_everywhere(): void
    {
        foreach (self::ENDPOINTS as $method) {
            $status = $this->statusOf(fn () => app(AdminAnalyticsController::class)
                ->{$method}($this->requestFor('moderator', ['reports' => false])));
            $this->assertSame(403, $status, $method);
        }
    }

    public function test_unauthenticated_caller_is_rejected_everywhere(): void
    {
        foreach (self::ENDPOINTS as $method) {
            $status = $this->statusOf(fn () => app(AdminAnalyticsController::class)
                ->{$method}($this->requestFor(null)));
            $this->assertSame(401, $status, $method);
        }
    }

    public function test_moderator_with_reports_permission_is_allowed(): void
    {
        $response = app(AdminAnalyticsController::class)->overview($this->requestFor('moderator', ['reports' => true]));
        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_moderator_with_default_permissions_is_allowed(): void
    {
        // The default permission set grants 'reports', so a moderator with no
        // custom staff_permissions keeps access — the fix only blocks explicit
        // revocation, it does not blanket-deny moderators.
        $response = app(AdminAnalyticsController::class)->overview($this->requestFor('moderator'));
        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_admin_is_allowed(): void
    {
        $response = app(AdminAnalyticsController::class)->overview($this->requestFor('admin'));
        $this->assertSame(200, $response->getStatusCode());
    }

    private function requestFor(?string $role, ?array $permissions = null): Request
    {
        $request = Request::create('/api/v1/admin/analytics/overview', 'GET');
        if ($role !== null) {
            $user = new User;
            $user->forceFill([
                'id' => self::UID,
                'admin_role' => $role,
                'staff_permissions' => $permissions !== null ? json_encode($permissions) : null,
            ]);
            $request->attributes->set('auth_user', $user);
        }

        return $request;
    }

    private function statusOf(callable $fn): int
    {
        try {
            $fn();
        } catch (ApiException $e) {
            return $e->getStatusCode();
        }

        return 0;
    }
}
