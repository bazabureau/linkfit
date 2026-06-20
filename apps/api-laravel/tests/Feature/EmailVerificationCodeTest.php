<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AuthExtrasController;
use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class EmailVerificationCodeTest extends TestCase
{
    public const USER_ID = '00000000-0000-4000-8000-000000000901';

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
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        DB::table('users')->insert([
            'id' => self::USER_ID,
            'email' => 'player@example.com',
            'display_name' => 'Player',
            'email_verified_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_send_verification_emails_a_short_lived_code(): void
    {
        $tokens = new FakeEmailTokenService;
        $mail = new FakeTransactionalMailService;
        $controller = new AuthExtrasController(app(PasswordService::class), $tokens, $mail);

        $request = Request::create('/api/v1/auth/send-verification', 'POST');
        $request->attributes->set('auth_user', User::findOrFail(self::USER_ID));

        $response = $controller->sendVerification($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(self::USER_ID, $tokens->createdForUserId);
        $this->assertSame('verify', $tokens->createdKind);
        $this->assertSame(10, $tokens->createdTtlMinutes);
        $this->assertSame('player@example.com', $mail->email);
        $this->assertSame('Player', $mail->name);
        $this->assertSame('654321', $mail->code);

        $payload = json_decode((string) $response->getContent(), true);
        $this->assertSame(['sent' => true, 'email' => 'player@example.com', 'expires_in_minutes' => 10], $payload);
    }

    public function test_verify_email_consumes_the_email_scoped_code(): void
    {
        $tokens = new FakeEmailTokenService;
        $controller = new AuthExtrasController(app(PasswordService::class), $tokens, new FakeTransactionalMailService);

        $request = Request::create('/api/v1/auth/verify-email', 'POST', [
            'email' => 'player@example.com',
            'code' => '123456',
        ]);

        $response = $controller->verifyEmail($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(self::USER_ID, $tokens->consumedForUserId);
        $this->assertSame('verify', $tokens->consumedKind);
        $this->assertSame('123456', $tokens->consumedCode);
        $this->assertNotNull(DB::table('users')->where('id', self::USER_ID)->value('email_verified_at'));
    }

    public function test_legacy_token_verification_still_works_for_old_email_links(): void
    {
        $tokens = new FakeEmailTokenService;
        $controller = new AuthExtrasController(app(PasswordService::class), $tokens, new FakeTransactionalMailService);

        $request = Request::create('/api/v1/auth/verify-email', 'POST', [
            'token' => 'legacy-opaque-token',
        ]);

        $response = $controller->verifyEmail($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('legacy-opaque-token', $tokens->consumedToken);
        $this->assertNotNull(DB::table('users')->where('id', self::USER_ID)->value('email_verified_at'));
    }
}

class FakeEmailTokenService extends EmailTokenService
{
    public ?string $createdForUserId = null;
    public ?string $createdKind = null;
    public ?int $createdTtlMinutes = null;
    public ?string $consumedForUserId = null;
    public ?string $consumedKind = null;
    public ?string $consumedCode = null;
    public ?string $consumedToken = null;

    public function createCode(string $userId, string $kind, int $ttlMinutes = 10): string
    {
        $this->createdForUserId = $userId;
        $this->createdKind = $kind;
        $this->createdTtlMinutes = $ttlMinutes;

        return '654321';
    }

    public function consumeCodeForUser(string $userId, string $kind, string $code): object
    {
        $this->consumedForUserId = $userId;
        $this->consumedKind = $kind;
        $this->consumedCode = $code;

        return (object) ['user_id' => $userId];
    }

    public function consume(string $token, string $kind): object
    {
        $this->consumedToken = $token;
        $this->consumedKind = $kind;

        return (object) ['user_id' => EmailVerificationCodeTest::USER_ID];
    }
}

class FakeTransactionalMailService extends TransactionalMailService
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
