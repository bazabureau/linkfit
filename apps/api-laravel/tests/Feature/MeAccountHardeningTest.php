<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MeController;
use App\Http\Controllers\Api\PreferencesController;
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
 * Hardening guard for the me / account / devices / sessions slice.
 *
 * Endpoints are exercised by instantiating the controller directly (the project
 * pattern — the routes sit behind jwt + PortalRoleGuard middleware) with the
 * authed user pinned via the `auth_user` request attribute, exactly as the
 * middleware would. Covers happy paths, IDOR scoping, and validation edges.
 */
class MeAccountHardeningTest extends TestCase
{
    private const USER_ID = '00000000-0000-4000-8000-0000000b0001';

    private const OTHER_ID = '00000000-0000-4000-8000-0000000b0002';

    private const CURRENT_FAMILY = 'fam-current';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('media.allowed_hosts', ['cdn.example.com']);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('display_name')->nullable();
            $table->string('phone')->nullable();
            $table->string('photo_url')->nullable();
            $table->float('home_lat')->nullable();
            $table->float('home_lng')->nullable();
            $table->string('password_hash')->nullable();
            $table->integer('quiet_hours_start')->nullable();
            $table->integer('quiet_hours_end')->nullable();
            $table->boolean('daily_digest_enabled')->default(true);
            $table->string('time_zone')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('refresh_tokens', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('family_id');
            $table->string('user_agent')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

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

        Schema::create('notification_preferences', function ($table): void {
            $table->string('user_id');
            $table->string('type');
            $table->boolean('push_enabled')->default(true);
            $table->boolean('email_enabled')->default(true);
            $table->boolean('in_app_enabled')->default(true);
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->unique(['user_id', 'type']);
        });

        DB::table('users')->insert([
            [
                'id' => self::USER_ID,
                'email' => 'player@example.com',
                'display_name' => 'Player',
                'password_hash' => app(PasswordService::class)->hash('correct-horse-1'),
                'daily_digest_enabled' => true,
                'time_zone' => 'Asia/Baku',
                'email_verified_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => self::OTHER_ID,
                'email' => 'other@example.com',
                'display_name' => 'Other',
                'password_hash' => app(PasswordService::class)->hash('correct-horse-1'),
                'daily_digest_enabled' => true,
                'time_zone' => 'Asia/Baku',
                'email_verified_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('notification_preferences');
        Schema::dropIfExists('device_tokens');
        Schema::dropIfExists('refresh_tokens');
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

    private function prefs(): PreferencesController
    {
        return new PreferencesController;
    }

    private function request(string $uri, string $method, array $body = [], string $userId = self::USER_ID): Request
    {
        $request = Request::create($uri, $method, $body);
        $request->attributes->set('auth_user', User::findOrFail($userId));
        $request->attributes->set('auth_family_id', self::CURRENT_FAMILY);

        return $request;
    }

    /** @return array{0:int,1:?ApiException} */
    private function capture(callable $fn): array
    {
        try {
            return [$fn()->getStatusCode(), null];
        } catch (ApiException $e) {
            return [$e->getStatusCode(), $e];
        }
    }

    // ---- update ----------------------------------------------------------

    public function test_update_applies_allowlisted_fields(): void
    {
        $response = $this->me()->update($this->request('/api/v1/me', 'PATCH', [
            'display_name' => 'New Name',
            'phone' => '+994 50 123 45 67',
            'home_lat' => 40.4,
            'home_lng' => 49.8,
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('users')->where('id', self::USER_ID)->first();
        $this->assertSame('New Name', $row->display_name);
        $this->assertSame('+994 50 123 45 67', $row->phone);
        $this->assertEqualsWithDelta(40.4, (float) $row->home_lat, 0.001);
        $this->assertEqualsWithDelta(49.8, (float) $row->home_lng, 0.001);
    }

    public function test_update_rejects_whitespace_only_display_name(): void
    {
        [$status] = $this->capture(fn () => $this->me()->update(
            $this->request('/api/v1/me', 'PATCH', ['display_name' => '   '])
        ));

        $this->assertSame(422, $status);
        $this->assertSame('Player', DB::table('users')->where('id', self::USER_ID)->value('display_name'));
    }

    public function test_update_requires_lat_and_lng_together(): void
    {
        [$status] = $this->capture(fn () => $this->me()->update(
            $this->request('/api/v1/me', 'PATCH', ['home_lat' => 40.4])
        ));

        $this->assertSame(422, $status);
    }

    public function test_update_rejects_empty_body(): void
    {
        [$status] = $this->capture(fn () => $this->me()->update(
            $this->request('/api/v1/me', 'PATCH', [])
        ));

        $this->assertSame(422, $status);
    }

    public function test_update_rejects_photo_url_on_disallowed_host(): void
    {
        [$status] = $this->capture(fn () => $this->me()->update(
            $this->request('/api/v1/me', 'PATCH', ['photo_url' => 'https://evil.example.net/a.jpg'])
        ));

        $this->assertSame(422, $status);
        $this->assertNull(DB::table('users')->where('id', self::USER_ID)->value('photo_url'));
    }

    public function test_update_accepts_photo_url_on_allowlisted_host(): void
    {
        $response = $this->me()->update($this->request('/api/v1/me', 'PATCH', [
            'photo_url' => 'https://cdn.example.com/avatars/me.jpg',
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(
            'https://cdn.example.com/avatars/me.jpg',
            DB::table('users')->where('id', self::USER_ID)->value('photo_url'),
        );
    }

    // ---- password --------------------------------------------------------

    public function test_change_password_rejects_wrong_current_password(): void
    {
        [$status, $e] = $this->capture(fn () => $this->me()->changePassword(
            $this->request('/api/v1/me/change-password', 'POST', [
                'current_password' => 'wrong-password',
                'password' => 'brand-new-pass-123',
            ])
        ));

        $this->assertSame(401, $status);
        $this->assertSame('UNAUTHENTICATED', $e?->wireCode());
    }

    public function test_change_password_updates_hash_and_revokes_other_families(): void
    {
        DB::table('refresh_tokens')->insert([
            ['id' => 'rt-current', 'user_id' => self::USER_ID, 'family_id' => self::CURRENT_FAMILY, 'created_at' => now()],
            ['id' => 'rt-other', 'user_id' => self::USER_ID, 'family_id' => 'fam-other', 'created_at' => now()],
        ]);

        $response = $this->me()->changePassword($this->request('/api/v1/me/change-password', 'POST', [
            'current_password' => 'correct-horse-1',
            'password' => 'brand-new-pass-123',
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $this->assertTrue($response->getData(true)['changed']);

        $hash = DB::table('users')->where('id', self::USER_ID)->value('password_hash');
        $this->assertTrue(app(PasswordService::class)->verify('brand-new-pass-123', $hash));

        $this->assertNull(DB::table('refresh_tokens')->where('id', 'rt-current')->value('revoked_at'));
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', 'rt-other')->value('revoked_at'));
    }

    public function test_change_password_enforces_letter_and_digit_policy(): void
    {
        [$status] = $this->capture(fn () => $this->me()->changePassword(
            $this->request('/api/v1/me/change-password', 'POST', [
                'current_password' => 'correct-horse-1',
                'password' => 'alllettersnodigits',
            ])
        ));

        $this->assertSame(422, $status);
    }

    // ---- sessions (IDOR) -------------------------------------------------

    public function test_sessions_lists_only_own_and_flags_current(): void
    {
        DB::table('refresh_tokens')->insert([
            ['id' => 'rt-mine', 'user_id' => self::USER_ID, 'family_id' => self::CURRENT_FAMILY, 'created_at' => now()],
            ['id' => 'rt-other-user', 'user_id' => self::OTHER_ID, 'family_id' => 'fam-x', 'created_at' => now()],
        ]);

        $items = $this->me()->sessions($this->request('/api/v1/me/sessions', 'GET'))->getData(true)['items'];

        $this->assertCount(1, $items);
        $this->assertSame('rt-mine', $items[0]['id']);
        $this->assertTrue($items[0]['is_current']);
    }

    public function test_delete_session_cannot_revoke_another_users_session(): void
    {
        DB::table('refresh_tokens')->insert([
            ['id' => 'rt-victim', 'user_id' => self::OTHER_ID, 'family_id' => 'fam-x', 'created_at' => now()],
        ]);

        $response = $this->me()->deleteSession($this->request('/api/v1/me/sessions/rt-victim', 'DELETE'), 'rt-victim');

        $this->assertSame(204, $response->getStatusCode());
        // The other user's session must remain active (IDOR scope).
        $this->assertNull(DB::table('refresh_tokens')->where('id', 'rt-victim')->value('revoked_at'));
    }

    public function test_delete_other_sessions_keeps_current_family(): void
    {
        DB::table('refresh_tokens')->insert([
            ['id' => 'rt-current', 'user_id' => self::USER_ID, 'family_id' => self::CURRENT_FAMILY, 'created_at' => now()],
            ['id' => 'rt-other', 'user_id' => self::USER_ID, 'family_id' => 'fam-other', 'created_at' => now()],
        ]);

        $this->me()->deleteOtherSessions($this->request('/api/v1/me/sessions', 'DELETE'));

        $this->assertNull(DB::table('refresh_tokens')->where('id', 'rt-current')->value('revoked_at'));
        $this->assertNotNull(DB::table('refresh_tokens')->where('id', 'rt-other')->value('revoked_at'));
    }

    // ---- devices (IDOR) --------------------------------------------------

    public function test_device_list_masks_token_and_scopes_to_user(): void
    {
        DB::table('device_tokens')->insert([
            ['id' => 'dev-1', 'user_id' => self::USER_ID, 'token' => 'apns-secret-token-1234567890', 'platform' => 'ios', 'last_seen' => now(), 'created_at' => now()],
            ['id' => 'dev-2', 'user_id' => self::OTHER_ID, 'token' => 'apns-other-token-1234567890', 'platform' => 'ios', 'last_seen' => now(), 'created_at' => now()],
        ]);

        $items = $this->me()->deviceList($this->request('/api/v1/me/devices', 'GET'))->getData(true)['items'];

        $this->assertCount(1, $items);
        $this->assertSame('dev-1', $items[0]['id']);
        $this->assertStringContainsString('...', $items[0]['token_preview']);
        $this->assertStringNotContainsString('secret-token', $items[0]['token_preview']);
    }

    public function test_delete_device_cannot_revoke_another_users_device(): void
    {
        DB::table('device_tokens')->insert([
            ['id' => 'dev-victim', 'user_id' => self::OTHER_ID, 'token' => 'victim-token', 'platform' => 'ios', 'last_seen' => now(), 'created_at' => now()],
        ]);

        $response = $this->me()->deleteDevice($this->request('/api/v1/me/devices/dev-victim', 'DELETE'), 'dev-victim');

        $this->assertSame(204, $response->getStatusCode());
        $this->assertNull(DB::table('device_tokens')->where('id', 'dev-victim')->value('revoked_at'));
    }

    public function test_device_register_rejects_invalid_platform(): void
    {
        [$status] = $this->capture(fn () => $this->me()->devices(
            $this->request('/api/v1/me/devices', 'POST', ['token' => 'tok', 'platform' => 'windows'])
        ));

        $this->assertSame(422, $status);
    }

    // ---- preferences -----------------------------------------------------

    public function test_daily_digest_stores_valid_timezone(): void
    {
        $response = $this->prefs()->dailyDigest($this->request('/api/v1/me/notification-preferences/daily-digest', 'PUT', [
            'enabled' => false,
            'time_zone' => 'Europe/Istanbul',
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('users')->where('id', self::USER_ID)->first();
        $this->assertFalse((bool) $row->daily_digest_enabled);
        $this->assertSame('Europe/Istanbul', $row->time_zone);
    }

    public function test_daily_digest_rejects_unparseable_timezone(): void
    {
        [$status] = $this->capture(fn () => $this->prefs()->dailyDigest(
            $this->request('/api/v1/me/notification-preferences/daily-digest', 'PUT', [
                'enabled' => true,
                'time_zone' => 'Not/AReal_Zone!!',
            ])
        ));

        $this->assertSame(422, $status);
        // The NOT NULL time_zone column keeps its prior valid value.
        $this->assertSame('Asia/Baku', DB::table('users')->where('id', self::USER_ID)->value('time_zone'));
    }

    public function test_quiet_hours_rejects_out_of_range_values(): void
    {
        [$status] = $this->capture(fn () => $this->prefs()->quietHours(
            $this->request('/api/v1/me/notification-preferences/quiet-hours', 'PUT', ['start' => 0, 'end' => 24])
        ));

        $this->assertSame(422, $status);
    }

    public function test_notification_preferences_patch_persists_only_known_types(): void
    {
        $response = $this->prefs()->patch($this->request('/api/v1/me/notification-preferences', 'PATCH', [
            'game_joined' => false,
            'not_a_real_type' => true,
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $rows = DB::table('notification_preferences')->where('user_id', self::USER_ID)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('game_joined', $rows->first()->type);
        $this->assertFalse((bool) $rows->first()->push_enabled);
    }
}
