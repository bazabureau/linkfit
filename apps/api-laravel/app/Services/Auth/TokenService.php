<?php

namespace App\Services\Auth;

use App\Models\User;
use App\Support\ApiException;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Wire-compatible implementation of the Linkfit auth token layer:
 *
 *  - Access token: HS256 JWT, payload { sub: <user id>, sid: <family id> },
 *    iat/exp auto-added, signed with JWT_ACCESS_SECRET, 15 min TTL.
 *  - Refresh token: 32 bytes CSPRNG → base64url string handed to the client;
 *    only its sha256 digest is stored in `refresh_tokens.token_hash` (bytea).
 *  - Rotation: refresh creates a new row in the SAME family_id and revokes
 *    the presented row (replaced_by). Reuse detection: presenting an already
 *    -revoked token revokes the WHOLE family (theft response) → 401.
 *
 * The AuthSession shape returned matches `AuthSessionSchema` 1:1 so the iOS
 * client decodes it unchanged.
 */
class TokenService
{
    private string $accessSecret;

    private int $accessTtlSeconds;

    private int $refreshTtlDays;

    public function __construct()
    {
        $this->accessSecret = (string) config('auth_tokens.access_secret');
        $this->accessTtlSeconds = (int) config('auth_tokens.access_ttl_seconds', 900);
        $this->refreshTtlDays = (int) config('auth_tokens.refresh_ttl_days', 30);
    }

    /** Mint a fresh session (register / login / OAuth). */
    public function issueSession(User $user, ?string $userAgent = null): array
    {
        $familyId = (string) Str::uuid();
        $refresh = $this->createRefreshRow($user->id, $familyId, $userAgent);
        $access = $this->mintAccessToken($user->id, $familyId);

        return $this->sessionPayload($user, $access, $refresh);
    }

    /** Rotate a presented refresh token, with reuse detection. */
    public function refresh(string $presentedToken, ?string $userAgent = null): array
    {
        $hashHex = hash('sha256', $presentedToken); // hex digest for bytea compare

        // Serialise concurrent refreshes of the SAME token (a normal pattern
        // when a client fires several requests on cold-start and each 401s →
        // refresh). Without the row lock both reads see revoked_at = null and
        // both rotate, creating two live siblings and later a spurious
        // family-wide "reuse" logout. lockForUpdate makes the loser block until
        // the winner commits, then see revoked_at set and 401 cleanly.
        return DB::transaction(function () use ($hashHex, $userAgent) {
            $row = DB::table('refresh_tokens')
                ->whereRaw('token_hash = decode(?, \'hex\')', [$hashHex])
                ->lockForUpdate()
                ->first();

            if ($row === null) {
                throw ApiException::unauthenticated('Invalid refresh token');
            }

            // Reuse detection: a revoked token presented again means the family
            // is compromised — revoke every sibling and reject.
            if ($row->revoked_at !== null) {
                DB::table('refresh_tokens')
                    ->where('family_id', $row->family_id)
                    ->whereNull('revoked_at')
                    ->update(['revoked_at' => now()]);
                throw ApiException::tokenReuse();
            }

            if (strtotime($row->expires_at) <= time()) {
                throw ApiException::unauthenticated('Refresh token expired');
            }

            $user = User::whereNull('deleted_at')->whereNull('suspended_at')->find($row->user_id);
            if ($user === null) {
                throw ApiException::unauthenticated('Account not found');
            }

            // Rotate: new token in the same family, old row revoked + linked.
            $next = $this->createRefreshRow($row->user_id, $row->family_id, $userAgent);
            $updates = [
                'revoked_at' => now(),
                'replaced_by' => $next['id'],
            ];
            if (Schema::hasColumn('refresh_tokens', 'last_used_at')) {
                $updates['last_used_at'] = now();
            }
            DB::table('refresh_tokens')->where('id', $row->id)->update($updates);

            $access = $this->mintAccessToken($user->id, $row->family_id);

            return $this->sessionPayload($user, $access, $next);
        });
    }

    /** Revoke a presented refresh token (logout). Idempotent. */
    public function revoke(string $presentedToken): void
    {
        $hashHex = hash('sha256', $presentedToken);
        $row = DB::table('refresh_tokens')
            ->whereRaw('token_hash = decode(?, \'hex\')', [$hashHex])
            ->first();
        if ($row === null) {
            return;
        }

        DB::table('refresh_tokens')
            ->where('id', $row->id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        // Refresh-token revocation does not by itself invalidate access tokens,
        // which stay verifiable until their `exp` (~15 min). Denylist the
        // session family (the access token's `sid` claim) so JwtAuthenticate
        // rejects any still-live access token for this logged-out session.
        $this->denylistFamily((string) $row->family_id);
    }

    /** Decode + validate an access token; returns claims or throws. */
    public function verifyAccess(string $token): object
    {
        return JWT::decode($token, new Key($this->accessSecret, 'HS256'));
    }

    public function accessTtlSeconds(): int
    {
        return $this->accessTtlSeconds;
    }

    /**
     * Block access tokens for a session family until they would expire anyway.
     * TTL matches the access-token TTL so the cache entry self-cleans once no
     * live token could carry this `sid`.
     */
    public function denylistFamily(string $familyId): void
    {
        if ($familyId === '') {
            return;
        }
        Cache::put($this->denylistKey($familyId), true, $this->accessTtlSeconds);
    }

    /** Has this session family been logged out / revoked? */
    public function isFamilyDenylisted(string $familyId): bool
    {
        if ($familyId === '') {
            return false;
        }

        return Cache::has($this->denylistKey($familyId));
    }

    private function denylistKey(string $familyId): string
    {
        return 'auth:revoked-session:'.$familyId;
    }

    // ── internals ──────────────────────────────────────────────────

    private function mintAccessToken(string $userId, string $familyId): string
    {
        $now = time();
        $payload = [
            'sub' => $userId,
            'sid' => $familyId,
            'iat' => $now,
            'exp' => $now + $this->accessTtlSeconds,
        ];

        return JWT::encode($payload, $this->accessSecret, 'HS256');
    }

    /**
     * Insert a new refresh_tokens row and return its id + the opaque token
     * string to hand back to the client.
     */
    private function createRefreshRow(string $userId, string $familyId, ?string $userAgent = null): array
    {
        $raw = random_bytes(32);
        $token = rtrim(strtr(base64_encode($raw), '+/', '-_'), '='); // base64url
        $hashHex = hash('sha256', $token);
        $id = (string) Str::uuid();

        $columns = ['id', 'user_id', 'token_hash', 'family_id', 'expires_at', 'created_at'];
        $values = ['?', '?', 'decode(?, \'hex\')', '?', '?', 'now()'];
        $bindings = [$id, $userId, $hashHex, $familyId, now()->addDays($this->refreshTtlDays)];
        if (Schema::hasColumn('refresh_tokens', 'user_agent')) {
            $columns[] = 'user_agent';
            $values[] = '?';
            $bindings[] = $userAgent !== null ? mb_substr($userAgent, 0, 512) : null;
        }
        if (Schema::hasColumn('refresh_tokens', 'last_used_at')) {
            $columns[] = 'last_used_at';
            $values[] = 'now()';
        }

        DB::statement(
            'INSERT INTO refresh_tokens ('.implode(', ', $columns).') VALUES ('.implode(', ', $values).')',
            $bindings
        );

        return ['id' => $id, 'token' => $token];
    }

    private function sessionPayload(User $user, string $access, array $refresh): array
    {
        return [
            'user' => $user->toPublicUser(),
            'access_token' => $access,
            'refresh_token' => $refresh['token'],
            'access_token_expires_in_seconds' => $this->accessTtlSeconds,
        ];
    }
}
