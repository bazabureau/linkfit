<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AuthExtrasController;
use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AuthExtrasHardeningTest extends TestCase
{
    public const ACTIVE_ID = '00000000-0000-4000-8000-0000000000b1';

    public const DELETED_ID = '00000000-0000-4000-8000-0000000000b2';

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
            $table->string('password_hash')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('refresh_tokens', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('family_id');
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            [
                'id' => self::ACTIVE_ID,
                'email' => 'live@example.com',
                'display_name' => 'Live Player',
                'password_hash' => app(PasswordService::class)->hash('old-password-123'),
                'email_verified_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
                'deleted_at' => null,
            ],
            [
                'id' => self::DELETED_ID,
                'email' => 'gone@example.com',
                'display_name' => 'Gone Player',
                'password_hash' => app(PasswordService::class)->hash('old-password-123'),
                'email_verified_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
                'deleted_at' => now(),
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('refresh_tokens');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function controller(SpyEmailTokenService $tokens, SpyAuthMailService $mail): AuthExtrasController
    {
        return new AuthExtrasController(app(PasswordService::class), $tokens, $mail);
    }

    public function test_request_password_reset_sends_code_and_normalizes_email_case(): void
    {
        $tokens = new SpyEmailTokenService;
        $mail = new SpyAuthMailService;

        // Mixed-case input must still resolve the lowercased stored address.
        $request = Request::create('/api/v1/auth/request-password-reset', 'POST', [
            'email' => 'Live@Example.COM',
        ]);

        $response = $this->controller($tokens, $mail)->requestPasswordReset($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(['requested' => true], json_decode((string) $response->getContent(), true));
        $this->assertSame(self::ACTIVE_ID, $tokens->createdForUserId);
        $this->assertSame('reset_password', $tokens->createdKind);
        $this->assertSame('live@example.com', $mail->resetEmail);
    }

    public function test_request_password_reset_ignores_soft_deleted_user(): void
    {
        $tokens = new SpyEmailTokenService;
        $mail = new SpyAuthMailService;

        $request = Request::create('/api/v1/auth/request-password-reset', 'POST', [
            'email' => 'gone@example.com',
        ]);

        $response = $this->controller($tokens, $mail)->requestPasswordReset($request);

        // No enumeration: same response, but no code is created or mailed for a
        // deleted account.
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(['requested' => true], json_decode((string) $response->getContent(), true));
        $this->assertNull($tokens->createdForUserId);
        $this->assertNull($mail->resetEmail);
    }

    public function test_request_password_reset_ignores_unknown_email(): void
    {
        $tokens = new SpyEmailTokenService;
        $mail = new SpyAuthMailService;

        $request = Request::create('/api/v1/auth/request-password-reset', 'POST', [
            'email' => 'nobody@example.com',
        ]);

        $response = $this->controller($tokens, $mail)->requestPasswordReset($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNull($tokens->createdForUserId);
    }

    public function test_verify_email_rejects_soft_deleted_user(): void
    {
        $controller = $this->controller(new SpyEmailTokenService, new SpyAuthMailService);

        $request = Request::create('/api/v1/auth/verify-email', 'POST', [
            'email' => 'gone@example.com',
            'code' => '123456',
        ]);

        $this->expectException(ApiException::class);
        $controller->verifyEmail($request);
    }

    public function test_verify_password_reset_code_rejects_soft_deleted_user(): void
    {
        $controller = $this->controller(new SpyEmailTokenService, new SpyAuthMailService);

        $request = Request::create('/api/v1/auth/verify-password-reset-code', 'POST', [
            'email' => 'gone@example.com',
            'code' => '123456',
        ]);

        $this->expectException(ApiException::class);
        $controller->verifyPasswordResetCode($request);
    }

    public function test_reset_password_rejects_weak_all_letter_password(): void
    {
        $controller = $this->controller(new SpyEmailTokenService, new SpyAuthMailService);

        $request = Request::create('/api/v1/auth/reset-password', 'POST', [
            'email' => 'live@example.com',
            'code' => '123456',
            'password' => 'abcdefghijklmno', // 15 letters, no digit
        ]);

        $this->expectException(ApiException::class);
        $controller->resetPassword($request);
    }

    public function test_reset_password_rejects_soft_deleted_user(): void
    {
        $controller = $this->controller(new SpyEmailTokenService, new SpyAuthMailService);

        $request = Request::create('/api/v1/auth/reset-password', 'POST', [
            'email' => 'gone@example.com',
            'code' => '123456',
            'password' => 'BrandNewPass1',
        ]);

        $this->expectException(ApiException::class);
        $controller->resetPassword($request);
    }

    public function test_reset_password_rewrites_hash_and_revokes_refresh_tokens(): void
    {
        DB::table('refresh_tokens')->insert([
            ['id' => 'rt-a', 'user_id' => self::ACTIVE_ID, 'family_id' => 'fam-a', 'revoked_at' => null, 'created_at' => now()],
            ['id' => 'rt-b', 'user_id' => self::ACTIVE_ID, 'family_id' => 'fam-b', 'revoked_at' => null, 'created_at' => now()],
        ]);

        $tokens = new SpyEmailTokenService;
        $controller = $this->controller($tokens, new SpyAuthMailService);

        $request = Request::create('/api/v1/auth/reset-password', 'POST', [
            'email' => 'live@example.com',
            'code' => '123456',
            'password' => 'BrandNewPass1',
        ]);

        $response = $controller->resetPassword($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(['reset' => true], json_decode((string) $response->getContent(), true));
        $this->assertSame(self::ACTIVE_ID, $tokens->consumedForUserId);
        $this->assertSame('reset_password', $tokens->consumedKind);

        $newHash = (string) DB::table('users')->where('id', self::ACTIVE_ID)->value('password_hash');
        $this->assertTrue(app(PasswordService::class)->verify('BrandNewPass1', $newHash));

        // Every live refresh token for the user is revoked after a reset.
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', 'rt-a')->value('revoked_at'));
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', 'rt-b')->value('revoked_at'));
    }
}

class SpyEmailTokenService extends EmailTokenService
{
    public ?string $createdForUserId = null;

    public ?string $createdKind = null;

    public ?string $consumedForUserId = null;

    public ?string $consumedKind = null;

    public function createCode(string $userId, string $kind, int $ttlMinutes = 10): string
    {
        $this->createdForUserId = $userId;
        $this->createdKind = $kind;

        return '654321';
    }

    public function consumeCodeForUser(string $userId, string $kind, string $code): object
    {
        $this->consumedForUserId = $userId;
        $this->consumedKind = $kind;

        return (object) ['user_id' => $userId];
    }

    public function verifyCodeForUser(string $userId, string $kind, string $code): object
    {
        return (object) ['user_id' => $userId];
    }

    public function consume(string $token, string $kind): object
    {
        return (object) ['user_id' => AuthExtrasHardeningTest::ACTIVE_ID];
    }
}

class SpyAuthMailService extends TransactionalMailService
{
    public ?string $resetEmail = null;

    public ?string $verifyEmail = null;

    public function emailVerification(string $email, string $name, string $code): void
    {
        $this->verifyEmail = $email;
    }

    public function passwordReset(string $email, string $name, string $code): void
    {
        $this->resetEmail = $email;
    }
}
