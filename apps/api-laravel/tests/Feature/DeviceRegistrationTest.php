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

class DeviceRegistrationTest extends TestCase
{
    public const USER_ID = '00000000-0000-4000-8000-0000000d0001';

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

        // Mirrors database/legacy-migrations/1700000040000_device-tokens.sql.
        // The (user_id, token) unique index is what makes the atomic upsert in
        // MeController::devices() race-safe — and is required for ON CONFLICT.
        Schema::create('device_tokens', function ($table): void {
            $table->string('id')->nullable();
            $table->string('user_id');
            $table->string('token');
            $table->string('platform');
            $table->timestamp('last_seen')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'token'], 'device_tokens_user_token_uq');
        });

        DB::table('users')->insert([
            'id' => self::USER_ID,
            'email' => 'player@example.com',
            'display_name' => 'Player',
            'password_hash' => app(PasswordService::class)->hash('correct-horse-1'),
            'email_verified_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('device_tokens');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function controller(): MeController
    {
        return new MeController(
            app(PasswordService::class),
            app(EmailTokenService::class),
            app(TransactionalMailService::class),
        );
    }

    private function register(string $token, string $platform = 'ios'): void
    {
        $request = Request::create('/api/v1/me/devices', 'POST', [
            'token' => $token,
            'platform' => $platform,
        ]);
        $request->attributes->set('auth_user', User::findOrFail(self::USER_ID));

        $response = $this->controller()->devices($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(['ok' => true], $response->getData(true));
    }

    public function test_registering_a_new_device_inserts_one_row(): void
    {
        $this->register('apns-token-aaaa');

        $rows = DB::table('device_tokens')->where('user_id', self::USER_ID)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('apns-token-aaaa', $rows->first()->token);
        $this->assertSame('ios', $rows->first()->platform);
        $this->assertNull($rows->first()->revoked_at);
    }

    public function test_re_registering_same_user_token_is_idempotent_and_creates_no_duplicate(): void
    {
        $this->register('apns-token-aaaa', 'ios');
        $originalCreatedAt = DB::table('device_tokens')
            ->where('user_id', self::USER_ID)
            ->where('token', 'apns-token-aaaa')
            ->value('created_at');

        // Second registration of the SAME (user, token) — the unique index would
        // 500 a naive insert; the upsert must absorb it cleanly.
        $this->register('apns-token-aaaa', 'android');

        $rows = DB::table('device_tokens')->where('user_id', self::USER_ID)->get();
        $this->assertCount(1, $rows, 'Re-registering the same token must not create a duplicate row');

        // Mutable columns refreshed, registration date preserved.
        $this->assertSame('android', $rows->first()->platform);
        $this->assertSame($originalCreatedAt, $rows->first()->created_at);
    }

    public function test_a_different_token_for_the_same_user_adds_a_second_row(): void
    {
        $this->register('apns-token-aaaa');
        $this->register('apns-token-bbbb');

        $rows = DB::table('device_tokens')->where('user_id', self::USER_ID)->get();
        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing(
            ['apns-token-aaaa', 'apns-token-bbbb'],
            $rows->pluck('token')->all(),
        );
    }
}
