<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\LaunchWaitlistController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Admin management of the public launch ("coming soon") waitlist signups
 * ({@see LaunchWaitlistController::adminIndex()} / ::adminUpdate()). Verifies the
 * staff gate (admin allowed, moderator-without-permission and non-staff rejected,
 * unauthenticated 401), the {items, pagination} envelope, status/role/search
 * filtering, and the status update lifecycle. Driven directly against an
 * in-memory SQLite schema, matching the other *HardeningTest fixtures.
 */
class LaunchWaitlistAdminTest extends TestCase
{
    private const ADMIN = '00000000-0000-4000-8000-0000000c0001';

    private const MOD = '00000000-0000-4000-8000-0000000c0002';

    private const PLAYER = '00000000-0000-4000-8000-0000000c0003';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('launch_waitlist_entries', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('phone')->nullable();
            $table->string('role')->default('player');
            $table->string('locale')->default('az');
            $table->string('source')->default('web_waitlist');
            $table->text('message')->nullable();
            $table->string('ip_address')->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->string('status', 40)->default('pending');
            $table->timestamps();
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

        DB::table('launch_waitlist_entries')->insert([
            ['id' => 'lw-1', 'name' => 'Alpha Player', 'email' => 'alpha@example.com', 'role' => 'player', 'status' => 'pending', 'created_at' => now()->subDays(3), 'updated_at' => now()->subDays(3)],
            ['id' => 'lw-2', 'name' => 'Beta Venue', 'email' => 'beta@venuelead.com', 'role' => 'venue', 'status' => 'invited', 'created_at' => now()->subDays(2), 'updated_at' => now()->subDays(2)],
            ['id' => 'lw-3', 'name' => 'Gamma Coach', 'email' => 'gamma@example.com', 'role' => 'coach', 'status' => 'pending', 'created_at' => now()->subDay(), 'updated_at' => now()->subDay()],
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['audit_log', 'launch_waitlist_entries'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    private function controller(): LaunchWaitlistController
    {
        return new LaunchWaitlistController;
    }

    private function requestAs(?string $role, array $params = [], string $method = 'GET'): Request
    {
        $request = Request::create('/api/v1/admin/launch-waitlist', $method, $params);
        if ($role !== null) {
            $id = match ($role) {
                'admin' => self::ADMIN,
                'moderator' => self::MOD,
                default => self::PLAYER,
            };
            $user = new User;
            $user->forceFill(['id' => $id, 'admin_role' => $role === 'player' ? null : $role, 'staff_permissions' => null]);
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

    public function test_index_requires_authentication(): void
    {
        $this->assertStatus(401, fn () => $this->controller()->adminIndex($this->requestAs(null)));
    }

    public function test_index_rejects_non_staff(): void
    {
        $this->assertStatus(403, fn () => $this->controller()->adminIndex($this->requestAs('player')));
    }

    public function test_index_rejects_moderator_without_operations_permission(): void
    {
        $this->assertStatus(403, fn () => $this->controller()->adminIndex($this->requestAs('moderator')));
    }

    public function test_index_returns_paginated_envelope_for_admin(): void
    {
        $data = $this->controller()->adminIndex($this->requestAs('admin'))->getData(true);

        $this->assertArrayHasKey('items', $data);
        $this->assertArrayHasKey('pagination', $data);
        $this->assertSame(3, $data['pagination']['total']);
        $this->assertCount(3, $data['items']);
        // Newest first.
        $this->assertSame('lw-3', $data['items'][0]['id']);
        $this->assertSame('pending', $data['items'][0]['status']);
        $this->assertArrayHasKey('email', $data['items'][0]);
        $this->assertArrayHasKey('name', $data['items'][0]);
        $this->assertArrayNotHasKey('ip_address', $data['items'][0]);
    }

    public function test_index_filters_by_status(): void
    {
        $data = $this->controller()->adminIndex($this->requestAs('admin', ['status' => 'invited']))->getData(true);

        $this->assertSame(1, $data['pagination']['total']);
        $this->assertSame('lw-2', $data['items'][0]['id']);
    }

    public function test_index_filters_by_role(): void
    {
        $data = $this->controller()->adminIndex($this->requestAs('admin', ['role' => 'coach']))->getData(true);

        $this->assertSame(1, $data['pagination']['total']);
        $this->assertSame('lw-3', $data['items'][0]['id']);
    }

    public function test_index_searches_email_and_name(): void
    {
        $data = $this->controller()->adminIndex($this->requestAs('admin', ['q' => 'venuelead']))->getData(true);

        $this->assertSame(1, $data['pagination']['total']);
        $this->assertSame('lw-2', $data['items'][0]['id']);
    }

    public function test_update_changes_status_and_audits(): void
    {
        $res = $this->controller()->adminUpdate($this->requestAs('admin', ['status' => 'joined'], 'PATCH'), 'lw-1');
        $data = $res->getData(true);

        $this->assertSame(200, $res->getStatusCode());
        $this->assertSame('joined', $data['status']);
        $this->assertSame('joined', DB::table('launch_waitlist_entries')->where('id', 'lw-1')->value('status'));
        $this->assertSame(1, DB::table('audit_log')->where('action', 'launch_waitlist.update')->where('entity_id', 'lw-1')->count());
    }

    public function test_update_rejects_invalid_status(): void
    {
        $this->assertStatus(422, fn () => $this->controller()->adminUpdate($this->requestAs('admin', ['status' => 'bogus'], 'PATCH'), 'lw-1'));
    }

    public function test_update_unknown_id_is_404(): void
    {
        $this->assertStatus(404, fn () => $this->controller()->adminUpdate($this->requestAs('admin', ['status' => 'invited'], 'PATCH'), 'does-not-exist'));
    }

    public function test_update_rejects_non_staff(): void
    {
        $this->assertStatus(403, fn () => $this->controller()->adminUpdate($this->requestAs('player', ['status' => 'invited'], 'PATCH'), 'lw-1'));
    }
}
