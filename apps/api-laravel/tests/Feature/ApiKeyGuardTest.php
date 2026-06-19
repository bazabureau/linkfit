<?php

namespace Tests\Feature;

use App\Http\Middleware\InternalApiKeyGuard;
use Illuminate\Support\Facades\Route;
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

    public function test_api_key_is_not_accepted_in_query_string(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->getJson('/api/v1/app/metadata?api_key=test-public-client-key-1234567890abcdef')
            ->assertForbidden();
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
}
