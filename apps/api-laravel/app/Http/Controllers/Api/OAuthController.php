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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

class OAuthController extends ApiController
{
    public function __construct(private readonly TokenService $tokens) {}

    public function google(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, ['id_token' => ['required', 'string', 'min:8', 'max:8192']]);

        // Bound the external call (no timeout = a hung Google endpoint hangs the
        // request) and fail CLOSED on any network/transport error: a transient
        // outage must reject with 401, never bubble up as a 500.
        try {
            $payload = Http::asForm()->timeout(8)
                ->get('https://oauth2.googleapis.com/tokeninfo', ['id_token' => $data['id_token']])
                ->json();
        } catch (Throwable $e) {
            report($e);
            $payload = null;
        }

        if (! is_array($payload) || ! $this->validGooglePayload($payload)) {
            return $this->unauth($request, 'Invalid Google token');
        }

        // validGooglePayload already required email_verified to be truthy, so the
        // email is provider-verified and safe to link an existing account by.
        return response()->json($this->sessionForOAuth('google_sub', (string) $payload['sub'], (string) $payload['email'], (string) ($payload['name'] ?? explode('@', (string) $payload['email'])[0]), true));
    }

    public function apple(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'identity_token' => ['required', 'string', 'min:8', 'max:8192'],
            'name' => ['sometimes', 'array'],
            'name.first' => ['sometimes', 'nullable', 'string', 'max:80'],
            'name.last' => ['sometimes', 'nullable', 'string', 'max:80'],
        ]);

        // CRITICAL: verify the Apple JWT signature against Apple's JWKS — never
        // trust an unverified base64-decoded payload (that is forgeable).
        $claims = $this->verifyAppleIdentityToken($data['identity_token']);
        if ($claims === null || empty($claims['sub']) || empty($claims['email'])) {
            return $this->unauth($request, 'Invalid Apple token');
        }

        // Account-takeover guard: sessionForOAuth links to an existing account by
        // email, so we may only do that when Apple asserts the email is verified.
        // Apple's `email_verified` claim is a bool OR the string "true"/"false";
        // a private-relay address is always Apple-verified. Treat a missing claim
        // as NOT verified (fail closed) — matches Google's email_verified gate.
        $appleEmailVerified = $claims['email_verified'] ?? null;
        $emailVerified = ($appleEmailVerified === true || $appleEmailVerified === 'true')
            || (($claims['is_private_email'] ?? null) === true || ($claims['is_private_email'] ?? null) === 'true');

        $name = trim(((string) ($data['name']['first'] ?? '')).' '.((string) ($data['name']['last'] ?? '')));

        return response()->json($this->sessionForOAuth('apple_sub', (string) $claims['sub'], (string) $claims['email'], $name !== '' ? $name : explode('@', (string) $claims['email'])[0], $emailVerified));
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
            // Fail CLOSED on audience: accept only a token whose aud is one of the
            // configured Apple client ids (the iOS bundle id by default, plus any
            // web Service ID). An empty set rejects everything — never skip the
            // audience check (that would accept tokens minted for any app).
            $clientIds = array_values(array_filter(array_map(
                'strval',
                (array) config('services.apple.client_ids', [])
            )));
            if ($clientIds === [] || ! in_array((string) ($decoded['aud'] ?? ''), $clientIds, true)) {
                return null;
            }

            return $decoded;
        } catch (Throwable $e) {
            // Returning null keeps the auth behaviour (caller rejects with 401),
            // but report the exception so a transient outage (e.g. Apple's JWKS
            // endpoint down) is visible rather than silently swallowed.
            report($e);

            return null;
        }
    }

    private function unauth(Request $request, string $message): JsonResponse
    {
        // Throw through ApiException so the response goes through ErrorEnvelope
        // like every other auth path (consistent envelope + request_id).
        throw ApiException::unauthenticated($message);
    }

    /**
     * tokeninfo verifies Google's signature server-side. We still enforce the
     * security-critical claims locally, including accepting every configured
     * mobile/web OAuth audience for the same LinkFit backend.
     *
     * @param  array<string,mixed>  $payload
     */
    private function validGooglePayload(array $payload): bool
    {
        $iss = (string) ($payload['iss'] ?? '');
        $emailVerified = $payload['email_verified'] ?? null;
        $exp = (int) ($payload['exp'] ?? 0);
        $clientIds = array_values(array_filter(array_map('strval', (array) config('services.google.client_ids', []))));

        // Fail CLOSED on audience: when no OAuth client ids are configured we must
        // reject (an empty allowlist accepts nothing), and otherwise only accept a
        // token whose aud is one of the configured client ids. Never skip the
        // audience check — doing so would accept tokens minted for any app.
        return ! empty($payload['sub'])
            && ! empty($payload['email'])
            && in_array($iss, ['accounts.google.com', 'https://accounts.google.com'], true)
            && ($exp === 0 || $exp > time())
            && ($emailVerified === true || $emailVerified === 'true')
            && $clientIds !== []
            && in_array((string) ($payload['aud'] ?? ''), $clientIds, true);
    }

    private function sessionForOAuth(string $column, string $sub, string $email, string $displayName, bool $emailVerified): array
    {
        $email = strtolower($email);
        // Clamp to the same length register enforces (users.display_name) so a
        // provider-supplied name can't write an oversized/garbage value.
        $displayName = mb_substr($displayName, 0, 80);

        // Lookup + create run inside a transaction so the whole link/create is
        // atomic. The DB's unique constraints on the provider-sub / email columns
        // remain the final guard against a concurrent duplicate-account insert.
        $user = DB::transaction(function () use ($column, $sub, $email, $displayName, $emailVerified) {
            $existing = User::where($column, $sub)->whereNull('deleted_at')->first();

            // Only link to a pre-existing account by email when the provider
            // asserts the email is verified — otherwise an attacker controlling
            // an unverified-email provider account could take over a victim's
            // password account that happens to share that email.
            if ($existing === null && $emailVerified) {
                $existing = User::where('email', $email)->whereNull('deleted_at')->first();
            }

            if ($existing === null) {
                $new = new User;
                $new->email = $email;
                $new->display_name = $displayName;
                $new->{$column} = $sub;
                if ($emailVerified) {
                    $new->email_verified_at = now();
                }
                $new->save();

                return $new;
            }

            $existing->{$column} = $sub;
            if ($emailVerified && $existing->email_verified_at === null) {
                $existing->email_verified_at = now();
            }
            $existing->save();

            return $existing;
        });

        return $this->tokens->issueSession($user);
    }
}
