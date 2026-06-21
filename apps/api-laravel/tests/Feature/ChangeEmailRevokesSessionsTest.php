<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MeController;
use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChangeEmailRevokesSessionsTest extends TestCase
{
    public const USER_ID = '00000000-0000-4000-8000-000000000a01';

    public const CURRENT_FAMILY = 'fam-current';

    public const OTHER_FAMILY_A = 'fam-other-a';

    public const OTHER_FAMILY_B = 'fam-other-b';

    private string $passwordHash;

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

        $this->passwordHash = app(PasswordService::class)->hash('correct-horse-1');

        DB::table('users')->insert([
            'id' => self::USER_ID,
            'email' => 'old@example.com',
            'display_name' => 'Player',
            'password_hash' => $this->passwordHash,
            'email_verified_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('refresh_tokens')->insert([
            ['id' => 'rt-current', 'user_id' => self::USER_ID, 'family_id' => self::CURRENT_FAMILY, 'revoked_at' => null, 'created_at' => now()],
            ['id' => 'rt-other-a', 'user_id' => self::USER_ID, 'family_id' => self::OTHER_FAMILY_A, 'revoked_at' => null, 'created_at' => now()],
            ['id' => 'rt-other-b', 'user_id' => self::USER_ID, 'family_id' => self::OTHER_FAMILY_B, 'revoked_at' => null, 'created_at' => now()],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('refresh_tokens');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_change_email_revokes_other_sessions_but_keeps_current(): void
    {
        $controller = new MeController(
            app(PasswordService::class),
            new NoopEmailTokenService,
            new NoopTransactionalMailService,
        );

        $request = Request::create('/api/v1/me/email', 'POST', [
            'email' => 'new@example.com',
            'current_password' => 'correct-horse-1',
        ]);
        $request->attributes->set('auth_user', User::findOrFail(self::USER_ID));
        $request->attributes->set('auth_family_id', self::CURRENT_FAMILY);

        $response = $controller->changeEmail($request);

        $this->assertSame(200, $response->getStatusCode());

        // The caller's own session stays active.
        $this->assertNull(DB::table('refresh_tokens')->where('id', 'rt-current')->value('revoked_at'));

        // Every other family is revoked.
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', 'rt-other-a')->value('revoked_at'));
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', 'rt-other-b')->value('revoked_at'));

        // The email + verification reset still happen.
        $user = DB::table('users')->where('id', self::USER_ID)->first();
        $this->assertSame('new@example.com', $user->email);
        $this->assertNull($user->email_verified_at);
    }
}

class NoopEmailTokenService extends EmailTokenService
{
    public function createCode(string $userId, string $kind, int $ttlMinutes = 10): string
    {
        return '654321';
    }
}

class NoopTransactionalMailService extends TransactionalMailService
{
    public function emailVerification(string $email, string $name, string $code): void
    {
        // no-op
    }
}
