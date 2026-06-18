<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Auth\TokenService;
use App\Support\ApiException;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

class OAuthController extends ApiController
{
    public function __construct(private readonly TokenService $tokens) {}

    public function google(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, ['id_token' => ['required', 'string', 'min:8', 'max:8192']]);
        $payload = Http::asForm()->get('https://oauth2.googleapis.com/tokeninfo', ['id_token' => $data['id_token']])->json();

        // Validate issuer, expiry, audience, and a verified email — tokeninfo
        // verifies the signature server-side, we enforce the remaining claims.
        $iss = (string) ($payload['iss'] ?? '');
        $emailVerified = ($payload['email_verified'] ?? null);
        $exp = (int) ($payload['exp'] ?? 0);
        $clientId = config('services.google.client_id');
        $ok = is_array($payload)
            && ! empty($payload['sub'])
            && ! empty($payload['email'])
            && in_array($iss, ['accounts.google.com', 'https://accounts.google.com'], true)
            && ($exp === 0 || $exp > time())
            && ($emailVerified === true || $emailVerified === 'true')
            && (! $clientId || ($payload['aud'] ?? null) === $clientId);

        if (! $ok) {
            return $this->unauth($request, 'Invalid Google token');
        }

        return response()->json($this->sessionForOAuth('google_sub', (string) $payload['sub'], (string) $payload['email'], (string) ($payload['name'] ?? explode('@', (string) $payload['email'])[0])));
    }

    public function apple(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'identity_token' => ['required', 'string', 'min:8', 'max:8192'],
            'name' => ['sometimes', 'array'],
        ]);

        // CRITICAL: verify the Apple JWT signature against Apple's JWKS — never
        // trust an unverified base64-decoded payload (that is forgeable).
        $claims = $this->verifyAppleIdentityToken($data['identity_token']);
        if ($claims === null || empty($claims['sub']) || empty($claims['email'])) {
            return $this->unauth($request, 'Invalid Apple token');
        }

        $name = trim(((string) ($data['name']['first'] ?? '')).' '.((string) ($data['name']['last'] ?? '')));

        return response()->json($this->sessionForOAuth('apple_sub', (string) $claims['sub'], (string) $claims['email'], $name !== '' ? $name : explode('@', (string) $claims['email'])[0]));
    }

    /**
     * Verify an Apple identity token: RS256 signature against Apple's published
     * JWKS, issuer = appleid.apple.com, not expired, and (when configured)
     * audience = our bundle id. Returns the claims or null.
     *
     * @return array<string,mixed>|null
     */
    private function verifyAppleIdentityToken(string $idToken): ?array
    {
        try {
            $jwks = Cache::remember('apple_jwks', 3600, function () {
                $res = Http::timeout(8)->get('https://appleid.apple.com/auth/keys')->json();

                return is_array($res) ? $res : null;
            });
            if (! is_array($jwks) || empty($jwks['keys'])) {
                return null;
            }

            // JWT::decode verifies the signature + `exp` against the JWKS.
            $decoded = (array) JWT::decode($idToken, JWK::parseKeySet($jwks));

            if (($decoded['iss'] ?? '') !== 'https://appleid.apple.com') {
                return null;
            }
            $clientId = config('services.apple.client_id');
            if ($clientId && ($decoded['aud'] ?? null) !== $clientId) {
                return null;
            }

            return $decoded;
        } catch (Throwable) {
            return null;
        }
    }

    private function unauth(Request $request, string $message): JsonResponse
    {
        // Throw through ApiException so the response goes through ErrorEnvelope
        // like every other auth path (consistent envelope + request_id).
        throw ApiException::unauthenticated($message);
    }

    private function sessionForOAuth(string $column, string $sub, string $email, string $displayName): array
    {
        $user = User::where($column, $sub)->whereNull('deleted_at')->first();
        if ($user === null) {
            // Safe to link by email: the provider token is now cryptographically
            // verified and the email is provider-verified (Apple inherently,
            // Google via email_verified).
            $user = User::where('email', strtolower($email))->whereNull('deleted_at')->first();
        }
        if ($user === null) {
            $user = new User;
            $user->email = strtolower($email);
            $user->display_name = $displayName;
            $user->{$column} = $sub;
            $user->email_verified_at = now();
            $user->save();
        } else {
            $user->{$column} = $sub;
            if ($user->email_verified_at === null) {
                $user->email_verified_at = now();
            }
            $user->save();
        }

        return $this->tokens->issueSession($user);
    }
}
