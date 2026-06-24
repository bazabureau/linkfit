<?php

namespace Tests\Unit;

use App\Http\Controllers\Api\OAuthController;
use App\Services\Auth\TokenService;
use ReflectionClass;
use Tests\TestCase;

class GoogleOAuthAudienceTest extends TestCase
{
    public function test_google_token_accepts_any_configured_oauth_client_id(): void
    {
        config()->set('services.google.client_ids', [
            'ios-client.apps.googleusercontent.com',
            'android-client.apps.googleusercontent.com',
            'web-client.apps.googleusercontent.com',
        ]);

        $this->assertTrue($this->validGooglePayload([
            'sub' => 'google-user-1',
            'email' => 'player@example.com',
            'email_verified' => 'true',
            'iss' => 'https://accounts.google.com',
            'aud' => 'android-client.apps.googleusercontent.com',
            'exp' => time() + 300,
        ]));
    }

    public function test_google_token_rejects_unconfigured_audience(): void
    {
        config()->set('services.google.client_ids', [
            'ios-client.apps.googleusercontent.com',
        ]);

        $this->assertFalse($this->validGooglePayload([
            'sub' => 'google-user-1',
            'email' => 'player@example.com',
            'email_verified' => true,
            'iss' => 'accounts.google.com',
            'aud' => 'other-client.apps.googleusercontent.com',
            'exp' => time() + 300,
        ]));
    }

    public function test_google_token_requires_verified_email_and_google_issuer(): void
    {
        // A client id must be configured for the audience check to pass — the
        // payload validation now fails CLOSED when no client ids are set.
        config()->set('services.google.client_ids', ['any-client.apps.googleusercontent.com']);

        $base = [
            'sub' => 'google-user-1',
            'email' => 'player@example.com',
            'email_verified' => true,
            'iss' => 'https://accounts.google.com',
            'aud' => 'any-client.apps.googleusercontent.com',
            'exp' => time() + 300,
        ];

        $this->assertTrue($this->validGooglePayload($base));
        $this->assertFalse($this->validGooglePayload([...$base, 'email_verified' => false]));
        $this->assertFalse($this->validGooglePayload([...$base, 'iss' => 'https://evil.example']));
        $this->assertFalse($this->validGooglePayload([...$base, 'exp' => time() - 1]));
    }

    public function test_google_token_fails_closed_when_no_client_ids_configured(): void
    {
        // Security: an empty allowlist must REJECT (never skip the audience check),
        // otherwise a token minted for any app would be accepted.
        config()->set('services.google.client_ids', []);

        $this->assertFalse($this->validGooglePayload([
            'sub' => 'google-user-1',
            'email' => 'player@example.com',
            'email_verified' => true,
            'iss' => 'https://accounts.google.com',
            'aud' => 'any-client.apps.googleusercontent.com',
            'exp' => time() + 300,
        ]));
    }

    /**
     * @param  array<string,mixed>  $payload
     */
    private function validGooglePayload(array $payload): bool
    {
        $controller = new OAuthController($this->app->make(TokenService::class));
        $method = (new ReflectionClass($controller))->getMethod('validGooglePayload');
        $method->setAccessible(true);

        return (bool) $method->invoke($controller, $payload);
    }
}
