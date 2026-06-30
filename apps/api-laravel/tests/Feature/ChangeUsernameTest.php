<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MeController;
use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Covers changing the authenticated user's username via `PATCH /me`
 * (MeController::update). The endpoint sits behind jwt + PortalRoleGuard, so —
 * per the project test pattern — the controller is instantiated directly with
 * the authed user pinned on the `auth_user` request attribute.
 *
 * Validation reuses the canonical registration rules (lowercase + trim, then
 * [a-z0-9._]{3,40}) and enforces case-insensitive uniqueness excluding self.
 */
class ChangeUsernameTest extends TestCase
{
    private const USER_ID = '00000000-0000-4000-8000-0000000c0001';

    private const OTHER_ID = '00000000-0000-4000-8000-0000000c0002';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        if (! Schema::hasTable('users')) {
            Schema::create('users', function ($table): void {
                $table->string('id')->primary();
                $table->string('email')->unique();
                $table->string('username', 40)->nullable()->unique();
                $table->string('display_name')->nullable();
                $table->string('phone')->nullable();
                $table->string('photo_url')->nullable();
                $table->float('home_lat')->nullable();
                $table->float('home_lng')->nullable();
                $table->string('password_hash')->nullable();
                $table->timestamp('email_verified_at')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->timestamp('updated_at')->nullable();
                $table->timestamp('deleted_at')->nullable();
            });
        }

        DB::table('users')->insert([
            [
                'id' => self::USER_ID,
                'email' => 'player@example.com',
                'username' => 'player_one',
                'display_name' => 'Player One',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => self::OTHER_ID,
                'email' => 'other@example.com',
                'username' => 'takenname',
                'display_name' => 'Other',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function me(): MeController
    {
        return new MeController(
            app(PasswordService::class),
            app(EmailTokenService::class),
            app(TransactionalMailService::class),
        );
    }

    private function request(array $body, ?string $userId = self::USER_ID): Request
    {
        $request = Request::create('/api/v1/me', 'PATCH', $body);
        if ($userId !== null) {
            $request->attributes->set('auth_user', User::findOrFail($userId));
        }

        return $request;
    }

    public function test_change_username_succeeds(): void
    {
        $response = $this->me()->update($this->request(['username' => 'New.Handle_99']));

        $this->assertSame(200, $response->getStatusCode());

        // Stored normalized to lowercase, and echoed back on the user payload.
        $this->assertSame('new.handle_99', DB::table('users')->where('id', self::USER_ID)->value('username'));
        $payload = $response->getData(true);
        $this->assertSame('new.handle_99', $payload['username']);
    }

    public function test_duplicate_username_case_insensitive_is_rejected(): void
    {
        // 'takenname' belongs to OTHER_ID — claiming it (any case) must 422.
        try {
            $this->me()->update($this->request(['username' => 'TakenName']));
            $this->fail('Expected a validation exception for a taken username');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
            $this->assertArrayHasKey('username', $e->getDetails()['issues'] ?? []);
        }

        // The caller's handle is unchanged.
        $this->assertSame('player_one', DB::table('users')->where('id', self::USER_ID)->value('username'));
    }

    public function test_invalid_username_format_is_rejected(): void
    {
        // Contains a space + '!' — outside the allowed [a-z0-9._] charset.
        try {
            $this->me()->update($this->request(['username' => 'bad name!']));
            $this->fail('Expected a validation exception for an invalid username');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
            $this->assertArrayHasKey('username', $e->getDetails()['issues'] ?? []);
        }

        $this->assertSame('player_one', DB::table('users')->where('id', self::USER_ID)->value('username'));
    }

    public function test_unauthenticated_change_is_rejected(): void
    {
        try {
            $this->me()->update($this->request(['username' => 'whoami'], userId: null));
            $this->fail('Expected an unauthenticated exception');
        } catch (ApiException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }
    }
}
