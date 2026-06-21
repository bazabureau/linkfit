<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\DataRightsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class AccountDeletionTest extends TestCase
{
    public const USER_ID = '00000000-0000-4000-8000-000000000a01';

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
            $table->string('display_name')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('refresh_tokens', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('token_hash');
            $table->string('family_id');
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->string('replaced_by')->nullable();
        });

        Schema::create('account_deletion_requests', function ($table): void {
            $table->string('user_id')->primary();
            $table->timestamp('requested_at')->nullable();
            $table->timestamp('hard_delete_at')->nullable();
            $table->string('status')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('completed_at')->nullable();
        });

        DB::table('users')->insert([
            'id' => self::USER_ID,
            'email' => 'leaver@example.com',
            'display_name' => 'Leaver',
            'created_at' => now(),
            'updated_at' => now(),
            'deleted_at' => null,
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('account_deletion_requests');
        Schema::dropIfExists('refresh_tokens');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function seedRefreshToken(?string $revokedAt = null): string
    {
        $id = (string) Str::uuid();
        DB::table('refresh_tokens')->insert([
            'id' => $id,
            'user_id' => self::USER_ID,
            'token_hash' => hash('sha256', $id),
            'family_id' => (string) Str::uuid(),
            'expires_at' => now()->addDays(30),
            'created_at' => now(),
            'revoked_at' => $revokedAt,
        ]);

        return $id;
    }

    private function request(string $path): Request
    {
        $request = Request::create($path, 'POST');
        $request->attributes->set('auth_user', User::findOrFail(self::USER_ID));

        return $request;
    }

    public function test_request_deletion_soft_deletes_user_and_revokes_refresh_tokens(): void
    {
        $live = $this->seedRefreshToken();
        $alreadyRevoked = $this->seedRefreshToken(revokedAt: (string) now()->subDay());

        $controller = new DataRightsController;
        $response = $controller->requestDeletion($this->request('/api/v1/me/deletion'));

        $this->assertSame(202, $response->getStatusCode());

        // Account is soft-deleted.
        $this->assertNotNull(DB::table('users')->where('id', self::USER_ID)->value('deleted_at'));

        // The live token is now revoked; the previously-revoked one is untouched.
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', $live)->value('revoked_at'));
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', $alreadyRevoked)->value('revoked_at'));

        // Deletion request row is scheduled with a ~30d hard-delete date.
        $row = DB::table('account_deletion_requests')->where('user_id', self::USER_ID)->first();
        $this->assertSame('scheduled', $row->status);
        $this->assertNotNull($row->hard_delete_at);
        $this->assertNull($row->cancelled_at);
    }

    public function test_after_request_deletion_login_lookup_excludes_user(): void
    {
        $controller = new DataRightsController;
        $controller->requestDeletion($this->request('/api/v1/me/deletion'));

        // Login does whereNull('deleted_at') — proving sign-in would now fail.
        $active = DB::table('users')
            ->where('id', self::USER_ID)
            ->whereNull('deleted_at')
            ->first();

        $this->assertNull($active);
    }

    public function test_cancel_deletion_restores_account_and_marks_request_cancelled(): void
    {
        $controller = new DataRightsController;
        $controller->requestDeletion($this->request('/api/v1/me/deletion'));

        $this->assertNotNull(DB::table('users')->where('id', self::USER_ID)->value('deleted_at'));

        $response = $controller->cancelDeletion($this->request('/api/v1/me/deletion/cancel'));
        $this->assertSame(200, $response->getStatusCode());

        // deleted_at cleared → account active again under whereNull('deleted_at').
        $this->assertNull(DB::table('users')->where('id', self::USER_ID)->value('deleted_at'));

        // Request row flipped to cancelled.
        $row = DB::table('account_deletion_requests')->where('user_id', self::USER_ID)->first();
        $this->assertSame('cancelled', $row->status);
        $this->assertNotNull($row->cancelled_at);
    }

    public function test_cancel_deletion_without_scheduled_request_returns_not_found(): void
    {
        $controller = new DataRightsController;

        $this->expectException(ApiException::class);
        $controller->cancelDeletion($this->request('/api/v1/me/deletion/cancel'));
    }
}
