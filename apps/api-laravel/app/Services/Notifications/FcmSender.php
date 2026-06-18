<?php

namespace App\Services\Notifications;

use Firebase\JWT\JWT;
use GuzzleHttp\Client as HttpClient;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Firebase Cloud Messaging (HTTP v1) sender for Android push delivery.
 *
 * Self-contained: mints the service-account OAuth2 access token with
 * firebase/php-jwt and delivers over guzzlehttp/guzzle — both already
 * required by the project, so no new Composer dependency is introduced.
 *
 * The sender is inert unless a Google service-account JSON key file is
 * configured via services.fcm.credentials_path; PushDispatcher checks
 * isConfigured() before calling send().
 */
class FcmSender
{
    private const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private ?array $credentials = null;

    /**
     * Whether a usable, readable service-account credentials file is present.
     */
    public function isConfigured(): bool
    {
        return $this->credentials() !== null;
    }

    /**
     * Deliver one alert to a set of Android registration tokens.
     *
     * @param  list<string>  $tokens
     * @param  array<string, mixed>  $data  flat string-coercible custom data
     * @return array{sent:int, dead_tokens:list<string>, error:?string}
     */
    public function send(array $tokens, string $title, string $body, array $data = []): array
    {
        $result = ['sent' => 0, 'dead_tokens' => [], 'error' => null];

        $creds = $this->credentials();
        if ($creds === null) {
            $result['error'] = 'FCM not configured';

            return $result;
        }

        try {
            $accessToken = $this->accessToken($creds);
        } catch (Throwable $e) {
            $result['error'] = 'FCM auth failed: '.$e->getMessage();

            return $result;
        }

        $projectId = (string) (config('services.fcm.project_id') ?: ($creds['project_id'] ?? ''));
        if ($projectId === '') {
            $result['error'] = 'FCM project_id missing';

            return $result;
        }

        // FCM data payloads must be string => string. Coerce here so callers
        // can pass the same custom array used for the APNs payload.
        $dataPayload = [];
        foreach ($data as $key => $value) {
            $dataPayload[(string) $key] = is_scalar($value) ? (string) $value : json_encode($value);
        }

        $http = new HttpClient([
            'base_uri' => "https://fcm.googleapis.com/v1/projects/{$projectId}/",
            'timeout' => 10,
        ]);

        foreach ($tokens as $token) {
            $token = (string) $token;
            if ($token === '') {
                continue;
            }

            try {
                $response = $http->post('messages:send', [
                    'headers' => [
                        'Authorization' => 'Bearer '.$accessToken,
                        'Content-Type' => 'application/json',
                    ],
                    'http_errors' => false,
                    'json' => [
                        'message' => [
                            'token' => $token,
                            'notification' => ['title' => $title, 'body' => $body],
                            'data' => $dataPayload,
                            'android' => ['priority' => 'high'],
                        ],
                    ],
                ]);
            } catch (Throwable $e) {
                // Network/transport error — treat as a soft failure for this
                // token; the job will retry rather than revoke the token.
                $result['error'] = 'FCM transport error: '.$e->getMessage();

                continue;
            }

            $status = $response->getStatusCode();
            if ($status === 200) {
                $result['sent']++;
                continue;
            }

            $bodyText = (string) $response->getBody();
            $errorCode = $this->fcmErrorCode($bodyText);

            // UNREGISTERED / INVALID_ARGUMENT (bad token) → revoke. 404 on the
            // messages:send endpoint for a token also means it's unregistered.
            if ($status === 404 || in_array($errorCode, ['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH'], true)) {
                $result['dead_tokens'][] = $token;
                continue;
            }

            $result['error'] = trim('FCM '.$status.' '.$errorCode);
        }

        return $result;
    }

    /**
     * Extract FCM error status from the v1 error envelope.
     */
    private function fcmErrorCode(string $bodyText): string
    {
        $decoded = json_decode($bodyText, true);
        if (! is_array($decoded)) {
            return '';
        }

        // Detailed FCM error: error.details[].errorCode (e.g. UNREGISTERED).
        foreach ($decoded['error']['details'] ?? [] as $detail) {
            if (isset($detail['errorCode'])) {
                return (string) $detail['errorCode'];
            }
        }

        return (string) ($decoded['error']['status'] ?? '');
    }

    /**
     * Fetch (and cache for ~55 min) an OAuth2 access token for the service
     * account using the JWT-bearer grant.
     *
     * @param  array<string, mixed>  $creds
     */
    private function accessToken(array $creds): string
    {
        $cacheKey = 'fcm:access_token:'.md5((string) ($creds['client_email'] ?? ''));

        return Cache::remember($cacheKey, 3300, function () use ($creds) {
            $now = time();
            $assertion = JWT::encode([
                'iss' => $creds['client_email'],
                'sub' => $creds['client_email'],
                'aud' => self::TOKEN_URL,
                'scope' => self::SCOPE,
                'iat' => $now,
                'exp' => $now + 3600,
            ], $creds['private_key'], 'RS256');

            $http = new HttpClient(['timeout' => 10]);
            $response = $http->post(self::TOKEN_URL, [
                'http_errors' => false,
                'form_params' => [
                    'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                    'assertion' => $assertion,
                ],
            ]);

            $decoded = json_decode((string) $response->getBody(), true);
            $token = is_array($decoded) ? ($decoded['access_token'] ?? null) : null;
            if (! is_string($token) || $token === '') {
                throw new \RuntimeException('No access_token in token response');
            }

            return $token;
        });
    }

    /**
     * Load + validate the service-account JSON once per request.
     *
     * @return array<string, mixed>|null
     */
    private function credentials(): ?array
    {
        if ($this->credentials !== null) {
            return $this->credentials;
        }

        $path = (string) config('services.fcm.credentials_path');
        if ($path === '' || ! is_readable($path)) {
            return null;
        }

        $decoded = json_decode((string) file_get_contents($path), true);
        if (! is_array($decoded) || empty($decoded['client_email']) || empty($decoded['private_key'])) {
            return null;
        }

        return $this->credentials = $decoded;
    }
}
