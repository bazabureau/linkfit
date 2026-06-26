<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\DataRightsController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * DataRightsController export + status reads:
 *  - requestExport() coalesces onto an in-flight request instead of spawning
 *    duplicate export jobs;
 *  - latestExport()/deletionStatus() are scoped to the caller (no IDOR) and
 *    return null cleanly when nothing exists.
 */
class DataRightsExportHardeningTest extends TestCase
{
    private const USER = '00000000-0000-4000-8000-000000000a01';

    private const OTHER = '00000000-0000-4000-8000-000000000a02';

    private DataRightsController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('data_export_requests', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('status')->default('queued');
            $table->text('download_url')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('completed_at')->nullable();
        });

        Schema::create('account_deletion_requests', function ($table): void {
            $table->string('user_id')->primary();
            $table->timestamp('requested_at')->nullable();
            $table->timestamp('hard_delete_at')->nullable();
            $table->string('status')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('completed_at')->nullable();
        });

        DB::table('users')->insert(['id' => self::USER]);
        DB::table('users')->insert(['id' => self::OTHER]);

        $this->controller = new DataRightsController;
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('account_deletion_requests');
        Schema::dropIfExists('data_export_requests');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function request(string $userId): Request
    {
        $request = Request::create('/api/v1/test', 'POST');
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }

    public function test_request_export_creates_a_queued_row(): void
    {
        $payload = $this->controller->requestExport($this->request(self::USER))->getData(true);

        $this->assertSame(self::USER, $payload['user_id']);
        $this->assertSame('queued', $payload['status']);
        $this->assertNull($payload['download_url']);
        $this->assertNotNull($payload['expires_at']);
        $this->assertSame(1, DB::table('data_export_requests')->where('user_id', self::USER)->count());
    }

    public function test_request_export_coalesces_onto_an_in_flight_request(): void
    {
        $first = $this->controller->requestExport($this->request(self::USER))->getData(true);
        $second = $this->controller->requestExport($this->request(self::USER))->getData(true);

        // Same row returned, and no duplicate export job row was created.
        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, DB::table('data_export_requests')->where('user_id', self::USER)->count());
    }

    public function test_request_export_does_not_coalesce_onto_a_terminal_request(): void
    {
        // A completed/expired export must not block a fresh one.
        DB::table('data_export_requests')->insert([
            'id' => 'old-ready',
            'user_id' => self::USER,
            'status' => 'ready',
            'download_url' => 'https://x/y.json',
            'expires_at' => now()->addDays(7),
            'created_at' => now()->subDay(),
            'completed_at' => now()->subDay(),
        ]);

        $payload = $this->controller->requestExport($this->request(self::USER))->getData(true);

        $this->assertSame('queued', $payload['status']);
        $this->assertNotSame('old-ready', $payload['id']);
        $this->assertSame(2, DB::table('data_export_requests')->where('user_id', self::USER)->count());
    }

    public function test_latest_export_is_scoped_to_caller(): void
    {
        // Another user's export must never surface for this caller.
        DB::table('data_export_requests')->insert([
            'id' => 'other-row',
            'user_id' => self::OTHER,
            'status' => 'queued',
            'expires_at' => now()->addDays(7),
            'created_at' => now(),
        ]);

        $this->assertEmpty($this->controller->latestExport($this->request(self::USER))->getData(true));

        $mine = $this->controller->requestExport($this->request(self::USER))->getData(true);
        $latest = $this->controller->latestExport($this->request(self::USER))->getData(true);
        $this->assertSame($mine['id'], $latest['id']);
        $this->assertSame(self::USER, $latest['user_id']);
    }

    public function test_deletion_status_returns_null_when_none_scheduled(): void
    {
        $this->assertEmpty($this->controller->deletionStatus($this->request(self::USER))->getData(true));
    }
}
