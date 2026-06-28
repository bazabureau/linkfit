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
use Tests\TestCase;

/**
 * Hardening coverage for the auth + oauth login/register slice
 * (AuthController, OAuthController). Controllers are exercised directly with
 * stubbed token/email/mail services so the assertions focus on validation,
 * authorization, conflict handling and the OAuth fail-closed paths.
 */
class AuthFlowHardeningTest extends TestCase
{
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
            $table->string('phone')->nullable();
            $table->string('username')->nullable()->unique();
            $table->string('display_name')->nullable();
            $table->string('password_hash')->nullable();
            $table->string('birth_date')->nullable();
            $table->string('google_sub')->nullable();
            $table->string('apple_sub')->nullable();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->timestamp('terms_accepted_at')->nullable();
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

    private function authController(): AuthController
    {
        return new AuthController(
            new AuthFlowFakeTokenService,
            app(PasswordService::class),
            new AuthFlowEmailTokenService,
            new AuthFlowMailService,
        );
    }

    private function insertUser(array $overrides = []): string
    {
        $id = $overrides['id'] ?? (string) \Illuminate\Support\Str::uuid();
        DB::table('users')->insert(array_merge([
            'id' => $id,
            'email' => 'existing@example.com',
            'username' => 'existing_user',
            'display_name' => 'Existing',
            'password_hash' => app(PasswordService::class)->hash('SuperSecret123'),
            'email_verified_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides, ['id' => $id]));

        return $id;
    }

    /** @return array{0:int,1:string} status + wire code of the thrown ApiException */
    private function captureApiException(callable $fn): array
    {
        try {
            $fn();
        } catch (ApiException $e) {
            return [$e->getStatusCode(), $e->wireCode()];
        }
        $this->fail('Expected ApiException was not thrown');
    }

    // ── register ────────────────────────────────────────────────────

    public function test_register_creates_user_hashes_password_and_returns_session(): void
    {
        $mail = new AuthFlowMailService;
        $controller = new AuthController(
            new AuthFlowFakeTokenService,
            app(PasswordService::class),
            new AuthFlowEmailTokenService,
            $mail,
        );

        $request = Request::create('/api/v1/auth/register', 'POST', [
            'email' => 'New.User@Example.com',
            'phone' => '+994 50 123 45 67',
            'password' => 'CorrectHorse12',
            'display_name' => 'New User',
        ]);

        $response = $controller->register($request);

        $this->assertSame(201, $response->getStatusCode());
        $payload = json_decode((string) $response->getContent(), true);
        $this->assertSame('new.user@example.com', $payload['user']['email']);
        $this->assertArrayHasKey('access_token', $payload);
        $this->assertArrayHasKey('refresh_token', $payload);

        $row = DB::table('users')->where('email', 'new.user@example.com')->first();
        $this->assertNotNull($row);
        // Password is stored as an argon2id hash, never as plaintext.
        $this->assertNotSame('CorrectHorse12', $row->password_hash);
        $this->assertTrue(app(PasswordService::class)->verify('CorrectHorse12', $row->password_hash));
        $this->assertNotEmpty($row->username);
        // The verification email was dispatched to the new address.
        $this->assertSame('new.user@example.com', $mail->email);
    }

    public function test_register_rejects_duplicate_email_with_conflict(): void
    {
        $this->insertUser(['email' => 'dup@example.com', 'username' => 'dupuser']);

        [$status, $code] = $this->captureApiException(fn () => $this->authController()->register(
            Request::create('/api/v1/auth/register', 'POST', [
                'email' => 'DUP@example.com',
                'phone' => '+994501112233',
                'password' => 'CorrectHorse12',
                'display_name' => 'Another',
            ])
        ));

        $this->assertSame(409, $status);
        $this->assertSame('CONFLICT', $code);
    }

    public function test_register_rejects_duplicate_username_with_conflict(): void
    {
        $this->insertUser(['email' => 'owner@example.com', 'username' => 'takenname']);

        [$status, $code] = $this->captureApiException(fn () => $this->authController()->register(
            Request::create('/api/v1/auth/register', 'POST', [
                'email' => 'fresh@example.com',
                'phone' => '+994501112233',
                'password' => 'CorrectHorse12',
                'display_name' => 'Fresh',
                'username' => 'TakenName',
            ])
        ));

        $this->assertSame(409, $status);
        $this->assertSame('CONFLICT', $code);
    }

    public function test_register_rejects_password_without_a_digit(): void
    {
        [$status, $code] = $this->captureApiException(fn () => $this->authController()->register(
            Request::create('/api/v1/auth/register', 'POST', [
                'email' => 'nodigit@example.com',
                'phone' => '+994501112233',
                'password' => 'abcdefghijklmno',
                'display_name' => 'No Digit',
            ])
        ));

        $this->assertSame(422, $status);
        $this->assertSame('VALIDATION_ERROR', $code);
    }

    public function test_register_rejects_short_password(): void
    {
        [$status, $code] = $this->captureApiException(fn () => $this->authController()->register(
            Request::create('/api/v1/auth/register', 'POST', [
                'email' => 'short@example.com',
                'phone' => '+994501112233',
                'password' => 'Ab1',
                'display_name' => 'Short',
            ])
        ));

        $this->assertSame(422, $status);
        $this->assertSame('VALIDATION_ERROR', $code);
    }

    public function test_register_rejects_impossible_birth_date(): void
    {
        [$status, $code] = $this->captureApiException(fn () => $this->authController()->register(
            Request::create('/api/v1/auth/register', 'POST', [
                'email' => 'badbirth@example.com',
                'phone' => '+994501112233',
                'password' => 'CorrectHorse12',
                'display_name' => 'Bad Birth',
                'birth_date' => '2010-13-40',
            ])
        ));

        $this->assertSame(422, $status);
        $this->assertSame('VALIDATION_ERROR', $code);
    }

    // ── login ───────────────────────────────────────────────────────

    public function test_login_succeeds_with_correct_credentials(): void
    {
        $this->insertUser(['email' => 'login@example.com', 'username' => 'loginuser']);

        $response = $this->authController()->login(Request::create('/api/v1/auth/login', 'POST', [
            'email' => 'LOGIN@example.com',
            'password' => 'SuperSecret123',
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $payload = json_decode((string) $response->getContent(), true);
        $this->assertSame('login@example.com', $payload['user']['email']);
        $this->assertArrayHasKey('access_token', $payload);
    }

    public function test_login_rejects_wrong_password(): void
    {
        $this->insertUser(['email' => 'login2@example.com', 'username' => 'loginuser2']);

        [$status, $code] = $this->captureApiException(fn () => $this->authController()->login(
            Request::create('/api/v1/auth/login', 'POST', [
                'email' => 'login2@example.com',
                'password' => 'WrongPassword99',
            ])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $code);
    }

    public function test_login_does_not_reveal_unknown_email(): void
    {
        [$status, $code] = $this->captureApiException(fn () => $this->authController()->login(
            Request::create('/api/v1/auth/login', 'POST', [
                'email' => 'ghost@example.com',
                'password' => 'SuperSecret123',
            ])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $code);
    }

    public function test_login_restores_soft_deleted_account_within_grace(): void
    {
        // A user who deleted their account can sign back in within the 30-day
        // grace window with the correct password: the account is restored
        // (deleted_at cleared) and the pending deletion is cancelled.
        $id = $this->insertUser([
            'email' => 'gone@example.com',
            'username' => 'goneuser',
            'deleted_at' => now(),
        ]);
        DB::table('account_deletion_requests')->insert([
            'user_id' => $id,
            'requested_at' => now(),
            'hard_delete_at' => now()->addDays(30),
            'status' => 'scheduled',
        ]);

        $response = $this->authController()->login(
            Request::create('/api/v1/auth/login', 'POST', [
                'email' => 'gone@example.com',
                'password' => 'SuperSecret123',
            ])
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNull(DB::table('users')->where('id', $id)->value('deleted_at'));
        $this->assertSame(
            'cancelled',
            DB::table('account_deletion_requests')->where('user_id', $id)->value('status'),
        );
    }

    public function test_login_rejects_soft_deleted_account_with_wrong_password(): void
    {
        // Restore only happens for the legitimate owner — a wrong password must
        // NOT reactivate a soft-deleted account.
        $id = $this->insertUser([
            'email' => 'gone@example.com',
            'username' => 'goneuser',
            'deleted_at' => now(),
        ]);

        [$status, $code] = $this->captureApiException(fn () => $this->authController()->login(
            Request::create('/api/v1/auth/login', 'POST', [
                'email' => 'gone@example.com',
                'password' => 'WrongPassword999',
            ])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $code);
        $this->assertNotNull(DB::table('users')->where('id', $id)->value('deleted_at'));
    }

    // ── role logins ─────────────────────────────────────────────────

    public function test_admin_login_forbids_non_admin_user(): void
    {
        $this->insertUser(['email' => 'plain@example.com', 'username' => 'plainuser', 'admin_role' => null]);

        [$status, $code] = $this->captureApiException(fn () => $this->authController()->adminLogin(
            Request::create('/api/v1/auth/admin/login', 'POST', [
                'email' => 'plain@example.com',
                'password' => 'SuperSecret123',
            ])
        ));

        $this->assertSame(403, $status);
        $this->assertSame('FORBIDDEN', $code);
    }

    public function test_admin_login_allows_admin_user(): void
    {
        $this->insertUser(['email' => 'admin@example.com', 'username' => 'adminuser', 'admin_role' => 'admin']);

        $response = $this->authController()->adminLogin(Request::create('/api/v1/auth/admin/login', 'POST', [
            'email' => 'admin@example.com',
            'password' => 'SuperSecret123',
        ]));

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_owner_login_requires_a_linked_venue(): void
    {
        $this->insertUser(['email' => 'partner@example.com', 'username' => 'partneruser', 'admin_role' => 'partner', 'venue_id' => null]);

        [$status, $code] = $this->captureApiException(fn () => $this->authController()->ownerLogin(
            Request::create('/api/v1/auth/owner/login', 'POST', [
                'email' => 'partner@example.com',
                'password' => 'SuperSecret123',
            ])
        ));

        $this->assertSame(403, $status);
        $this->assertSame('FORBIDDEN', $code);
    }

    // ── google oauth ────────────────────────────────────────────────

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

    public function test_google_creates_session_for_a_valid_token(): void
    {
        Http::fake(['oauth2.googleapis.com/*' => Http::response($this->googlePayload(), 200)]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        $response = $controller->google(Request::create('/api/v1/auth/google', 'POST', [
            'id_token' => 'a-valid-looking-id-token',
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('users')->where('email', 'oauthuser@example.com')->first();
        $this->assertNotNull($row);
        $this->assertSame('google-sub-123', $row->google_sub);
        $this->assertNotNull($row->email_verified_at);
    }

    public function test_google_links_existing_account_by_verified_email(): void
    {
        $existingId = $this->insertUser(['email' => 'oauthuser@example.com', 'username' => 'existingoauth']);
        Http::fake(['oauth2.googleapis.com/*' => Http::response($this->googlePayload(), 200)]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        $response = $controller->google(Request::create('/api/v1/auth/google', 'POST', [
            'id_token' => 'a-valid-looking-id-token',
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(1, DB::table('users')->where('email', 'oauthuser@example.com')->count());
        $row = DB::table('users')->where('id', $existingId)->first();
        $this->assertSame('google-sub-123', $row->google_sub);
    }

    public function test_google_rejects_invalid_token(): void
    {
        Http::fake(['oauth2.googleapis.com/*' => Http::response(['error_description' => 'Invalid Value'], 400)]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        [$status, $code] = $this->captureApiException(fn () => $controller->google(
            Request::create('/api/v1/auth/google', 'POST', ['id_token' => 'garbage-token'])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $code);
    }

    public function test_google_rejects_audience_mismatch(): void
    {
        Http::fake(['oauth2.googleapis.com/*' => Http::response($this->googlePayload(['aud' => 'some-other-app']), 200)]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        [$status] = $this->captureApiException(fn () => $controller->google(
            Request::create('/api/v1/auth/google', 'POST', ['id_token' => 'token-for-other-app'])
        ));

        $this->assertSame(401, $status);
        // No account should be provisioned from a token minted for another app.
        $this->assertSame(0, DB::table('users')->where('email', 'oauthuser@example.com')->count());
    }

    public function test_google_rejects_unverified_email(): void
    {
        Http::fake(['oauth2.googleapis.com/*' => Http::response($this->googlePayload(['email_verified' => 'false']), 200)]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        [$status] = $this->captureApiException(fn () => $controller->google(
            Request::create('/api/v1/auth/google', 'POST', ['id_token' => 'unverified-token'])
        ));

        $this->assertSame(401, $status);
    }

    public function test_google_fails_closed_when_token_endpoint_errors(): void
    {
        Http::fake(['oauth2.googleapis.com/*' => fn () => throw new \Illuminate\Http\Client\ConnectionException('timed out')]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        [$status, $code] = $this->captureApiException(fn () => $controller->google(
            Request::create('/api/v1/auth/google', 'POST', ['id_token' => 'a-valid-looking-id-token'])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $code);
    }

    // ── apple oauth ─────────────────────────────────────────────────

    public function test_apple_rejects_token_when_jwks_unavailable(): void
    {
        Http::fake(['appleid.apple.com/*' => Http::response(['keys' => []], 200)]);
        $controller = new OAuthController(new AuthFlowFakeTokenService);

        [$status, $code] = $this->captureApiException(fn () => $controller->apple(
            Request::create('/api/v1/auth/apple', 'POST', ['identity_token' => 'this-is-not-a-real-apple-jwt'])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $code);
    }
}

class AuthFlowFakeTokenService extends TokenService
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

class AuthFlowEmailTokenService extends EmailTokenService
{
    public function createCode(string $userId, string $kind, int $ttlMinutes = 10): string
    {
        return '654321';
    }
}

class AuthFlowMailService extends TransactionalMailService
{
    public ?string $email = null;

    public ?string $name = null;

    public ?string $code = null;

    public function emailVerification(string $email, string $name, string $code): void
    {
        $this->email = $email;
        $this->name = $name;
        $this->code = $code;
    }
}
