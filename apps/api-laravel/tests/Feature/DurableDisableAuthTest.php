<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\OAuthController;
use App\Http\Controllers\AuthController;
use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Auth\TokenService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * #2 — restore-on-login (and OAuth) must distinguish a USER-INITIATED account
 * deletion (a scheduled account_deletion_requests row still inside its grace
 * window — auto-restorable) from an ADMIN removal (deleted_at with no scheduled
 * request — a DURABLE disable). The latter must NOT be reversible by signing in
 * with correct credentials: it stays disabled (deleted_at preserved) and the
 * caller is rejected.
 */
class DurableDisableAuthTest extends TestCase
{
    private const PASSWORD = 'SuperSecret123';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('cache.default', 'array');
        config()->set('services.google.client_ids', ['linkfit-test-client']);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('display_name')->nullable();
            $table->string('password_hash')->nullable();
            $table->string('google_sub')->nullable();
            $table->string('apple_sub')->nullable();
            $table->string('admin_role')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('account_deletion_requests', function ($table): void {
            $table->string('user_id')->primary();
            $table->timestamp('requested_at')->nullable();
            $table->timestamp('hard_delete_at')->nullable();
            $table->string('status')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('completed_at')->nullable();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('account_deletion_requests');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    // ---- login ---------------------------------------------------------------

    public function test_login_to_admin_disabled_account_is_forbidden_and_keeps_deleted_at(): void
    {
        // deleted_at set with NO scheduled self-deletion = an admin ban/removal.
        $id = $this->insertUser(['email' => 'banned@example.com', 'deleted_at' => now()]);

        $status = $this->statusOf(fn () => $this->authController()->login(
            Request::create('/api/v1/auth/login', 'POST', [
                'email' => 'banned@example.com',
                'password' => self::PASSWORD,
            ])
        ));

        $this->assertSame(403, $status, 'correct credentials must NOT restore an admin-disabled account');
        $this->assertNotNull(DB::table('users')->where('id', $id)->value('deleted_at'));
    }

    public function test_login_self_deleted_within_grace_still_restores(): void
    {
        $id = $this->insertUser(['email' => 'gone@example.com', 'deleted_at' => now()]);
        $this->scheduleDeletion($id, now()->addDays(30));

        $response = $this->authController()->login(Request::create('/api/v1/auth/login', 'POST', [
            'email' => 'gone@example.com',
            'password' => self::PASSWORD,
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNull(DB::table('users')->where('id', $id)->value('deleted_at'));
        $this->assertSame('cancelled', DB::table('account_deletion_requests')->where('user_id', $id)->value('status'));
    }

    public function test_login_self_deletion_past_grace_is_forbidden(): void
    {
        // A scheduled row whose grace window already elapsed is not auto-restorable.
        $id = $this->insertUser(['email' => 'expired@example.com', 'deleted_at' => now()]);
        $this->scheduleDeletion($id, now()->subDay());

        $status = $this->statusOf(fn () => $this->authController()->login(
            Request::create('/api/v1/auth/login', 'POST', [
                'email' => 'expired@example.com',
                'password' => self::PASSWORD,
            ])
        ));

        $this->assertSame(403, $status);
        $this->assertNotNull(DB::table('users')->where('id', $id)->value('deleted_at'));
    }

    // ---- google oauth --------------------------------------------------------

    public function test_google_login_to_admin_disabled_account_is_forbidden(): void
    {
        $id = $this->insertUser([
            'email' => 'oauthbanned@example.com',
            'google_sub' => 'google-sub-123',
            'email_verified_at' => now(),
            'deleted_at' => now(),
        ]);
        Http::fake(['oauth2.googleapis.com/*' => Http::response($this->googlePayload([
            'sub' => 'google-sub-123',
            'email' => 'oauthbanned@example.com',
        ]), 200)]);

        $status = $this->statusOf(fn () => (new OAuthController(new DurableDisableTokenService))->google(
            Request::create('/api/v1/auth/google', 'POST', ['id_token' => 'a-valid-looking-id-token'])
        ));

        $this->assertSame(403, $status);
        $this->assertNotNull(DB::table('users')->where('id', $id)->value('deleted_at'));
        // No fresh row is minted over the soft-deleted one.
        $this->assertSame(1, DB::table('users')->where('email', 'oauthbanned@example.com')->count());
    }

    public function test_google_login_self_deleted_within_grace_restores(): void
    {
        $id = $this->insertUser([
            'email' => 'oauthgone@example.com',
            'google_sub' => 'google-sub-456',
            'email_verified_at' => now(),
            'deleted_at' => now(),
        ]);
        $this->scheduleDeletion($id, now()->addDays(20));
        Http::fake(['oauth2.googleapis.com/*' => Http::response($this->googlePayload([
            'sub' => 'google-sub-456',
            'email' => 'oauthgone@example.com',
        ]), 200)]);

        $response = (new OAuthController(new DurableDisableTokenService))->google(
            Request::create('/api/v1/auth/google', 'POST', ['id_token' => 'a-valid-looking-id-token'])
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNull(DB::table('users')->where('id', $id)->value('deleted_at'));
        $this->assertSame('cancelled', DB::table('account_deletion_requests')->where('user_id', $id)->value('status'));
    }

    // ---- helpers -------------------------------------------------------------

    private function authController(): AuthController
    {
        return new AuthController(
            new DurableDisableTokenService,
            app(PasswordService::class),
            new DurableDisableEmailTokenService,
            new DurableDisableMailService,
        );
    }

    private function insertUser(array $overrides): string
    {
        $id = $overrides['id'] ?? (string) Str::uuid();
        DB::table('users')->insert(array_merge([
            'id' => $id,
            'email' => 'user@example.com',
            'display_name' => 'User',
            'password_hash' => app(PasswordService::class)->hash(self::PASSWORD),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides, ['id' => $id]));

        return $id;
    }

    private function scheduleDeletion(string $userId, \Carbon\CarbonInterface $hardDeleteAt): void
    {
        DB::table('account_deletion_requests')->insert([
            'user_id' => $userId,
            'requested_at' => now(),
            'hard_delete_at' => $hardDeleteAt,
            'status' => 'scheduled',
        ]);
    }

    private function googlePayload(array $overrides = []): array
    {
        return array_merge([
            'sub' => 'google-sub-123',
            'email' => 'oauthuser@example.com',
            'email_verified' => 'true',
            'iss' => 'https://accounts.google.com',
            'aud' => 'linkfit-test-client',
            'exp' => time() + 3600,
            'name' => 'OAuth User',
        ], $overrides);
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

class DurableDisableTokenService extends TokenService
{
    public function issueSession(User $user, ?string $userAgent = null): array
    {
        return [
            'user' => $user->toPublicUser(),
            'access_token' => 'fake.access.token',
            'refresh_token' => 'fake-refresh-token',
            'access_token_expires_in_seconds' => 900,
        ];
    }
}

class DurableDisableEmailTokenService extends EmailTokenService
{
    public function createCode(string $userId, string $kind, int $ttlMinutes = 10): string
    {
        return '654321';
    }
}

class DurableDisableMailService extends TransactionalMailService
{
    public function emailVerification(string $email, string $name, string $code): void {}
}
