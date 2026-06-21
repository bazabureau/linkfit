<?php

namespace Tests\Feature;

use App\Http\Middleware\InternalApiKeyGuard;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Route;
use ReflectionMethod;
use Tests\TestCase;

class ApiKeyGuardTest extends TestCase
{
    public function test_public_api_key_is_required_when_gate_is_enabled(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->getJson('/api/v1/app/metadata')
            ->assertForbidden();

        $this->getJson('/api/v1/app/metadata', [
            'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
        ])
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_sampled_api_surface_requires_public_api_key_when_gate_is_enabled(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        foreach ([
            '/health',
            '/api/v1/app/capabilities',
            '/api/v1/mobile/config',
            '/api/v1/membership/plans',
            '/api/v1/realtime/health',
        ] as $path) {
            $this->getJson($path)->assertForbidden();

            $this->getJson($path, [
                'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
            ])->assertOk();
        }
    }

    public function test_api_key_is_not_accepted_in_query_string(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->getJson('/api/v1/app/metadata?api_key=test-public-client-key-1234567890abcdef')
            ->assertForbidden();
    }

    public function test_api_key_is_only_accepted_from_linkfit_header(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->getJson('/api/v1/app/metadata', [
            'X-API-Key' => 'test-public-client-key-1234567890abcdef',
        ])
            ->assertForbidden();

        $this->getJson('/api/v1/app/metadata', [
            'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
        ])
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_broadcasting_auth_requires_public_api_key_when_gate_is_enabled(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->postJson('/broadcasting/auth', [
            'channel_name' => 'private-conversation.test',
            'socket_id' => '123.456',
        ])->assertForbidden();
    }

    public function test_broadcasting_auth_reaches_jwt_guard_after_public_api_key_passes(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->postJson('/broadcasting/auth', [
            'channel_name' => 'private-conversation.test',
            'socket_id' => '123.456',
        ], [
            'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
        ])->assertUnauthorized();
    }

    public function test_public_api_key_can_be_stored_as_sha256_hash(): void
    {
        $key = 'test-public-client-key-1234567890abcdef';
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', []);
        config()->set('app.api_key_hashes', [hash('sha256', $key)]);

        $this->getJson('/api/v1/app/metadata', [
            'X-Linkfit-App-Key' => $key,
        ])
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_public_infrastructure_assets_do_not_require_app_key(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->getJson('/.well-known/apple-app-site-association')
            ->assertOk()
            ->assertJsonPath('applinks.apps', []);

        $this->get('/og/game/test')
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png');

        $this->getJson('/api/v1/app/metadata')
            ->assertForbidden();
    }

    public function test_browser_origin_must_be_allowed_even_without_public_api_key_gate(): void
    {
        config()->set('app.require_api_key', false);
        config()->set('cors.allowed_origins', ['https://linkfit.az']);

        $this->getJson('/api/v1/app/metadata', [
            'Origin' => 'https://evil.example',
        ])
            ->assertForbidden();

        $this->getJson('/api/v1/app/metadata', [
            'Origin' => 'https://linkfit.az',
        ])
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_null_or_malformed_browser_origin_is_rejected(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);
        config()->set('cors.allowed_origins', ['https://linkfit.az']);

        foreach (['null', 'file://local-app', 'not-a-valid-origin'] as $origin) {
            $this->getJson('/api/v1/app/metadata', [
                'Origin' => $origin,
                'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
            ])
                ->assertForbidden();
        }
    }

    public function test_native_requests_without_origin_still_use_public_api_key_only(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);
        config()->set('cors.allowed_origins', ['https://linkfit.az']);

        $this->getJson('/api/v1/app/metadata', [
            'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
        ])
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_internal_api_key_uses_separate_header_and_keyring(): void
    {
        Route::middleware([InternalApiKeyGuard::class])->get('/_test/internal-key', fn () => response()->json(['ok' => true]));

        config()->set('app.internal_api_keys', ['test-internal-server-key-1234567890abcdef']);

        $this->getJson('/_test/internal-key', [
            'X-Linkfit-App-Key' => 'test-internal-server-key-1234567890abcdef',
        ])
            ->assertForbidden();

        $this->getJson('/_test/internal-key', [
            'X-Linkfit-Internal-Key' => 'test-internal-server-key-1234567890abcdef',
        ])
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_internal_api_key_can_be_stored_as_sha256_hash(): void
    {
        Route::middleware([InternalApiKeyGuard::class])->get('/_test/internal-key-hash', fn () => response()->json(['ok' => true]));

        $key = 'test-internal-server-key-1234567890abcdef';
        config()->set('app.internal_api_keys', []);
        config()->set('app.internal_api_key_hashes', [hash('sha256', $key)]);

        $this->getJson('/_test/internal-key-hash', [
            'X-Linkfit-Internal-Key' => $key,
        ])
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_real_internal_route_accepts_internal_key_without_public_app_key(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);
        config()->set('app.internal_api_keys', ['test-internal-server-key-1234567890abcdef']);

        $this->getJson('/api/v1/internal/capabilities', [
            'X-Linkfit-Internal-Key' => 'test-internal-server-key-1234567890abcdef',
        ])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('mode', 'internal')
            ->assertJsonPath('api_key_type', 'internal')
            ->assertJsonPath('features.server_to_server', true);
    }

    public function test_real_internal_route_rejects_public_app_key_without_internal_key(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);
        config()->set('app.internal_api_keys', ['test-internal-server-key-1234567890abcdef']);

        $this->getJson('/api/v1/internal/capabilities', [
            'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
        ])
            ->assertForbidden()
            ->assertJsonPath('error.message', 'Invalid or missing internal API key');
    }

    public function test_api_key_generator_outputs_plain_key_and_hash(): void
    {
        Artisan::call('security:make-api-key');
        $output = Artisan::output();

        $this->assertMatchesRegularExpression('/key: lf_public_[a-f0-9]{64}/', $output);
        $this->assertMatchesRegularExpression('/sha256: [a-f0-9]{64}/', $output);
        $this->assertStringContainsString('APP_PUBLIC_API_KEY_HASHES', $output);

        Artisan::call('security:make-api-key --internal');
        $internalOutput = Artisan::output();

        $this->assertMatchesRegularExpression('/key: lf_internal_[a-f0-9]{64}/', $internalOutput);
        $this->assertMatchesRegularExpression('/sha256: [a-f0-9]{64}/', $internalOutput);
        $this->assertStringContainsString('INTERNAL_API_KEY_HASHES', $internalOutput);
    }

    public function test_production_accepts_disabled_public_app_key_gate(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('app.require_api_key', false);
        config()->set('app.api_keys', []);
        config()->set('app.api_key_hashes', []);
        config()->set('app.internal_api_keys', []);
        config()->set('app.internal_api_key_hashes', [hash('sha256', 'test-internal-server-key-1234567890abcdef')]);

        $this->invokeApiKeyBootGuard();

        $this->assertTrue(true);
    }

    public function test_production_rejects_public_app_key_config_when_gate_is_disabled(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('app.require_api_key', false);
        config()->set('app.api_keys', []);
        config()->set('app.api_key_hashes', [hash('sha256', 'test-public-client-key-1234567890abcdef')]);
        config()->set('app.internal_api_keys', []);
        config()->set('app.internal_api_key_hashes', [hash('sha256', 'test-internal-server-key-1234567890abcdef')]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('APP_PUBLIC_API_KEYS and APP_PUBLIC_API_KEY_HASHES must be empty when REQUIRE_API_KEY=false in production');

        $this->invokeApiKeyBootGuard();
    }

    public function test_production_public_app_keys_must_be_hash_only(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);
        config()->set('app.api_key_hashes', []);
        config()->set('app.internal_api_keys', []);
        config()->set('app.internal_api_key_hashes', [hash('sha256', 'test-internal-server-key-1234567890abcdef')]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('APP_PUBLIC_API_KEYS must be empty in production');

        $this->invokeApiKeyBootGuard();
    }

    public function test_production_requires_internal_api_key_hashes(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('app.require_api_key', false);
        config()->set('app.api_keys', []);
        config()->set('app.api_key_hashes', []);
        config()->set('app.internal_api_keys', []);
        config()->set('app.internal_api_key_hashes', []);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('INTERNAL_API_KEY_HASHES must contain at least one internal server key hash in production');

        $this->invokeApiKeyBootGuard();
    }

    public function test_production_internal_app_keys_must_be_hash_only(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', []);
        config()->set('app.api_key_hashes', [hash('sha256', 'test-public-client-key-1234567890abcdef')]);
        config()->set('app.internal_api_keys', ['test-internal-server-key-1234567890abcdef']);
        config()->set('app.internal_api_key_hashes', []);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('INTERNAL_API_KEYS must be empty in production');

        $this->invokeApiKeyBootGuard();
    }

    private function invokeApiKeyBootGuard(): void
    {
        $provider = new AppServiceProvider($this->app);
        $method = new ReflectionMethod($provider, 'assertStrongApiKeys');
        $method->setAccessible(true);
        $method->invoke($provider);
    }
}
