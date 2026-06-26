<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Auth\PasswordService;
use App\Services\Auth\TokenService;
use Firebase\JWT\JWT;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

/**
 * Cookie-auth contract coverage. Web (admin/partner/web) clients carry the
 * access/refresh tokens in httpOnly lf_access/lf_refresh cookies instead of
 * JS-readable storage. Every change is ADDITIVE: the JSON body STILL returns
 * access_token/refresh_token (the mobile app + the existing Bearer tests rely
 * on that), and the Bearer header still wins over the cookie.
 *
 * A real login mints a Postgres-only refresh_tokens row (decode(?, 'hex')) that
 * can't run on the in-memory sqlite test DB, so we bind a TokenService whose
 * issueSession returns a real signed access token and whose revoke() only
 * denylists the session family — exercising the controller/middleware wiring
 * (cookies, fallback, denylist) without the Postgres-specific SQL.
 */
class CookieAuthTest extends TestCase
{
    private string $userId = '019edbc3-a5fb-7123-9e6f-cc5d6d897393';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('cache.default', 'array');
        config()->set('auth_tokens.access_secret', 'test-access-secret-with-more-than-32-characters');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('phone')->nullable();
            $table->string('username')->nullable();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->string('password_hash')->nullable();
            $table->decimal('home_lat', 9, 6)->nullable();
            $table->decimal('home_lng', 9, 6)->nullable();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->boolean('is_vip')->default(false);
            $table->timestamp('vip_expires_at')->nullable();
            $table->string('vip_badge_label')->nullable();
            $table->boolean('is_verified')->default(false);
            $table->boolean('is_ambassador')->default(false);
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('suspended_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        DB::table('users')->insert([
            'id' => $this->userId,
            'email' => 'cookie@example.test',
            'username' => 'cookieuser',
            'display_name' => 'Cookie User',
            'password_hash' => app(PasswordService::class)->hash('SuperSecret123'),
            'email_verified_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Real signed access token (so cookie auth on /me works) + a fixed
        // refresh token; revoke() denylists the family without DB SQL.
        $this->app->instance(TokenService::class, new CookieAuthFakeTokenService);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_login_sets_httponly_access_and_refresh_cookies(): void
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'email' => 'cookie@example.test',
            'password' => 'SuperSecret123',
        ]);

        $response->assertOk();
        $body = $response->json();

        // The JSON body STILL carries the tokens — the mobile/native contract is
        // unchanged. The cookies are purely additive on top.
        $this->assertArrayHasKey('access_token', $body);
        $this->assertArrayHasKey('refresh_token', $body);

        $access = $this->cookieFrom($response, 'lf_access');
        $refresh = $this->cookieFrom($response, 'lf_refresh');

        $this->assertNotNull($access, 'lf_access cookie must be set on login');
        $this->assertNotNull($refresh, 'lf_refresh cookie must be set on login');
        $this->assertTrue($access->isHttpOnly(), 'lf_access must be httpOnly');
        $this->assertTrue($refresh->isHttpOnly(), 'lf_refresh must be httpOnly');
        // Cookie carries the RAW token (API routes do not encrypt cookies).
        $this->assertSame($body['access_token'], $access->getValue());
        $this->assertSame($body['refresh_token'], $refresh->getValue());
        $this->assertSame('lax', strtolower((string) $access->getSameSite()));
    }

    public function test_me_authenticates_via_lf_access_cookie_only(): void
    {
        $accessToken = $this->postJson('/api/v1/auth/login', [
            'email' => 'cookie@example.test',
            'password' => 'SuperSecret123',
        ])->assertOk()->json('access_token');

        // No Authorization header at all — the lf_access cookie alone must
        // authenticate the request. withCredentials() mirrors the browser's
        // credentials:"include" (the test client only sends cookies on JSON
        // requests when credentials are enabled).
        $this->withCredentials()
            ->withUnencryptedCookie('lf_access', $accessToken)
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('id', $this->userId)
            ->assertJsonPath('email', 'cookie@example.test');
    }

    public function test_logout_via_cookie_clears_cookies_and_denylists_access(): void
    {
        $login = $this->postJson('/api/v1/auth/login', [
            'email' => 'cookie@example.test',
            'password' => 'SuperSecret123',
        ])->assertOk();
        $accessToken = $login->json('access_token');
        $refreshToken = $login->json('refresh_token');

        // The access cookie authenticates /me before logout.
        $this->withCredentials()
            ->withUnencryptedCookie('lf_access', $accessToken)
            ->getJson('/api/v1/me')
            ->assertOk();

        // Cookie-only logout: no JSON body, just the lf_refresh cookie.
        $logout = $this->withCredentials()
            ->withUnencryptedCookie('lf_refresh', $refreshToken)
            ->postJson('/api/v1/auth/logout');
        $logout->assertStatus(204);

        // Both cookies are cleared (empty value and/or expired in the past).
        foreach (['lf_access', 'lf_refresh'] as $name) {
            $cleared = $this->cookieFrom($logout, $name);
            $this->assertNotNull($cleared, "$name must be cleared on logout");
            $this->assertTrue(
                $cleared->getValue() === '' || $cleared->getExpiresTime() < time(),
                "$name must be expired/emptied on logout"
            );
        }

        // The same access cookie is now rejected — its session family is
        // denylisted, so the still-cryptographically-valid token no longer auths.
        $this->withCredentials()
            ->withUnencryptedCookie('lf_access', $accessToken)
            ->getJson('/api/v1/me')
            ->assertStatus(401);
    }

    private function cookieFrom(TestResponse $response, string $name): ?Cookie
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie;
            }
        }

        return null;
    }
}

/**
 * Avoids the Postgres-only refresh_tokens SQL on the sqlite test DB: mints a
 * real signed access token (so the cookie auth path works) and denylists the
 * session family on revoke (so a logged-out access cookie is rejected).
 */
class CookieAuthFakeTokenService extends TokenService
{
    public string $familyId = 'cookie-test-family';

    public function issueSession(User $user, ?string $userAgent = null): array
    {
        $now = time();
        $access = JWT::encode([
            'sub' => $user->id,
            'sid' => $this->familyId,
            'iat' => $now,
            'exp' => $now + 900,
        ], (string) config('auth_tokens.access_secret'), 'HS256');

        return [
            'user' => $user->toPublicUser(),
            'access_token' => $access,
            'refresh_token' => 'cookie-refresh-token-value-1234567890',
            'access_token_expires_in_seconds' => 900,
        ];
    }

    public function revoke(string $presentedToken): void
    {
        // Skip the Postgres-specific refresh_tokens revoke SQL; the denylist
        // (cache-backed) is what JwtAuthenticate checks to reject the access
        // token/cookie of a logged-out session.
        $this->denylistFamily($this->familyId);
    }
}
