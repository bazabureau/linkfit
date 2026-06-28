<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Auth\TokenService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * /api/v1/auth/* — wire-compatible with the contract the iOS client
 * speaks. All responses are the exact `AuthSession` shape; all errors flow
 * through ApiException → ErrorEnvelope.
 */
class AuthController extends Controller
{
    public function __construct(
        private readonly TokenService $tokens,
        private readonly PasswordService $passwords,
        private readonly EmailTokenService $emailTokens,
        private readonly TransactionalMailService $mail,
    ) {}

    /** POST /api/v1/auth/register → 201 AuthSession */
    public function register(Request $request): JsonResponse
    {
        $data = $this->validate($request, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'phone' => ['required', 'string', 'min:7', 'max:40', 'regex:/^\+?[0-9\s().-]{7,40}$/'],
            'password' => ['required', 'string', 'min:12', 'max:200'],
            'password_confirmation' => ['sometimes', 'string', 'same:password'],
            'display_name' => ['required', 'string', 'max:80'],
            'username' => ['sometimes', 'nullable', 'string', 'min:3', 'max:40', 'regex:/^[a-zA-Z0-9._]+$/'],
            'birth_date' => ['nullable', 'string', 'regex:/^\d{4}-\d{2}-\d{2}$/', 'date_format:Y-m-d'],
            'ref' => ['nullable', 'string', 'max:16'],
            'accepted_terms' => ['sometimes', 'boolean'],
        ]);

        $email = mb_strtolower(trim($data['email']));
        $phone = preg_replace('/\s+/', ' ', trim($data['phone']));
        $displayName = trim($data['display_name']);
        $requestedUsername = isset($data['username']) ? $this->normalizeUsername((string) $data['username']) : '';
        $username = $requestedUsername !== '' ? $requestedUsername : $this->uniqueUsernameFromDisplayName($displayName);

        if ($displayName === '') {
            throw ApiException::validation('Display name is required');
        }
        if ($requestedUsername !== '' && ! $this->isValidUsername($requestedUsername)) {
            throw ApiException::validation('Username must be 3-40 characters and can only contain letters, numbers, dots, and underscores');
        }
        // Password policy: at least one letter and one digit.
        if (! preg_match('/[A-Za-z]/', $data['password']) || ! preg_match('/\d/', $data['password'])) {
            throw ApiException::validation('Password must contain a letter and a digit');
        }

        if (User::where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }
        if ($requestedUsername !== '' && User::where('username', $username)->exists()) {
            throw ApiException::conflict('Username is already taken');
        }

        $user = new User;
        $user->email = $email;
        $user->phone = $phone;
        $user->password_hash = $this->passwords->hash($data['password']);
        $user->username = $username;
        $user->display_name = $displayName;
        if (! empty($data['birth_date'])) {
            $user->birth_date = $data['birth_date'];
        }
        // Record consent to the Terms & Privacy Policy when the client confirms
        // acceptance (the web sign-up requires the checkbox).
        if (! empty($data['accepted_terms'])) {
            $user->terms_accepted_at = now();
        }
        try {
            $user->save();
        } catch (QueryException $e) {
            // A concurrent sign-up won the race between the existence pre-checks
            // above and this insert. The DB's unique constraints are the final
            // guard — re-map the violation to the same 409 those checks return
            // instead of leaking a 500.
            if (User::where('email', $email)->exists()) {
                throw ApiException::conflict('Email is already registered');
            }
            if (User::where('username', $username)->exists()) {
                throw ApiException::conflict('Username is already taken');
            }
            throw $e;
        }
        // Record the referral when the sign-up carries a referral code (from a
        // linkfit.az/r/{code} share link). Best-effort: a bad/duplicate code must
        // never block registration.
        if (! empty($data['ref'])) {
            $this->applyReferral($user, strtoupper(trim($data['ref'])));
        }
        $code = $this->emailTokens->createCode($user->id, 'verify', 10);
        $this->mail->emailVerification($user->email, $user->display_name ?: 'Linkfit user', $code);

        return $this->respondSession($this->tokens->issueSession($user, $request->userAgent()), 201);
    }

    /**
     * Link a brand-new user to their referrer (mirrors ReferralsController@redeem).
     * Silent no-op on invalid code, self-referral, or an already-referred user.
     */
    private function applyReferral(User $user, string $code): void
    {
        if (! preg_match('/^[A-HJ-NP-Z2-9]{6}$/', $code)) {
            return;
        }
        try {
            $referrer = DB::table('users')->where('referral_code', $code)->whereNull('deleted_at')->first();
            if ($referrer === null || $referrer->id === $user->id) {
                return;
            }
            if (DB::table('referrals')->where('referee_user_id', $user->id)->exists()) {
                return;
            }
            DB::transaction(function () use ($user, $referrer, $code) {
                DB::table('referrals')->insert([
                    'referee_user_id' => $user->id,
                    'referrer_user_id' => $referrer->id,
                    'code_used' => $code,
                    'created_at' => now(),
                ]);
                DB::table('users')->where('id', $user->id)->update(['referred_by_user_id' => $referrer->id, 'updated_at' => now()]);
                DB::table('users')->where('id', $referrer->id)->increment('referral_count');
            });
        } catch (\Throwable $e) {
            // Best-effort — never fail signup because of a referral hiccup, but
            // surface the failure to the exception handler (Sentry) so a lost
            // referral credit is not silently swallowed with zero audit trail.
            report($e);
        }
    }

    /** POST /api/v1/auth/login → 200 AuthSession */
    public function login(Request $request): JsonResponse
    {
        $data = $this->validate($request, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'max:200'],
        ]);

        $email = mb_strtolower(trim($data['email']));
        $user = User::whereNull('deleted_at')->where('email', $email)->first();

        // Re-login to an account soft-deleted within the 30-day grace window:
        // when the password matches, RESTORE it (clear deleted_at + cancel the
        // pending deletion) and sign in — so a user who deleted their account
        // can come back, matching the GDPR cancellation window. After the hard
        // purge the row is gone and this falls through to the normal 401.
        if ($user === null) {
            $deleted = User::whereNotNull('deleted_at')->where('email', $email)->first();
            if ($deleted !== null && $deleted->password_hash !== null
                && $this->passwords->verify($data['password'], $deleted->password_hash)) {
                // Correct credentials for a disabled account. ONLY auto-restore
                // when the USER themselves scheduled the deletion and the grace
                // window is still open. An admin removal (suspend/ban — deleted_at
                // with no scheduled self-deletion) is a DURABLE disable the user
                // must not be able to undo just by signing back in.
                if ($this->hasOpenSelfDeletion((string) $deleted->id)) {
                    $deleted->deleted_at = null;
                    $deleted->save();
                    DB::table('account_deletion_requests')
                        ->where('user_id', $deleted->id)
                        ->where('status', 'scheduled')
                        ->update(['status' => 'cancelled', 'cancelled_at' => now()]);

                    return $this->respondSession(
                        $this->tokens->issueSession($deleted, $request->userAgent()),
                        200,
                    );
                }

                throw ApiException::forbidden('This account has been disabled');
            }
        }

        // Constant-ish response: never reveal whether the email exists.
        if ($user === null || $user->password_hash === null
            || ! $this->passwords->verify($data['password'], $user->password_hash)) {
            throw ApiException::unauthenticated('Invalid email or password');
        }

        return $this->respondSession($this->tokens->issueSession($user, $request->userAgent()), 200);
    }

    public function adminLogin(Request $request): JsonResponse
    {
        return $this->roleLogin($request, ['admin', 'moderator'], 'Admin access required');
    }

    public function ownerLogin(Request $request): JsonResponse
    {
        return $this->roleLogin($request, ['partner'], 'Owner access required');
    }

    public function coachLogin(Request $request): JsonResponse
    {
        return $this->roleLogin($request, ['coach'], 'Coach access required');
    }

    /** POST /api/v1/auth/refresh → 200 AuthSession */
    public function refresh(Request $request): JsonResponse
    {
        // Accept the refresh token from the JSON body (mobile/native clients) OR
        // from the httpOnly lf_refresh cookie (web clients). The body wins when
        // both are present; the cookie-only case is validated below.
        $data = $this->validate($request, [
            'refresh_token' => ['sometimes', 'string', 'min:10', 'max:200'],
        ]);

        $refreshToken = $data['refresh_token'] ?? $this->refreshTokenFromCookie($request);
        if ($refreshToken === null) {
            throw ApiException::unauthenticated('Missing refresh token');
        }

        return $this->respondSession($this->tokens->refresh($refreshToken, $request->userAgent()), 200);
    }

    /** POST /api/v1/auth/logout → 204 (idempotent) */
    public function logout(Request $request): JsonResponse
    {
        // Same fallback as refresh(): a cookie-only web client sends no body.
        $data = $this->validate($request, [
            'refresh_token' => ['sometimes', 'string', 'min:10', 'max:200'],
        ]);

        $refreshToken = $data['refresh_token'] ?? $this->refreshTokenFromCookie($request);
        if ($refreshToken !== null) {
            $this->tokens->revoke($refreshToken);
        }

        // Always clear BOTH auth cookies (idempotent — safe even when the client
        // only carried a Bearer token). Expired Set-Cookie with the SAME
        // domain/path is what removes them from the browser.
        return $this->forgetSessionCookies(response()->json(null, 204));
    }

    /**
     * True when the user has an OPEN, USER-INITIATED deletion request still
     * inside its grace window (status='scheduled' AND hard_delete_at in the
     * future). Only such a self-deletion may be auto-reversed by signing back
     * in — an admin removal sets deleted_at with NO scheduled request and is a
     * durable disable.
     */
    private function hasOpenSelfDeletion(string $userId): bool
    {
        return DB::table('account_deletion_requests')
            ->where('user_id', $userId)
            ->where('status', 'scheduled')
            ->where('hard_delete_at', '>', now())
            ->exists();
    }

    /** Read the refresh token from the httpOnly lf_refresh cookie (web clients). */
    private function refreshTokenFromCookie(Request $request): ?string
    {
        $cookie = $request->cookie('lf_refresh');
        $cookie = is_string($cookie) ? trim($cookie) : '';

        return $cookie !== '' ? $cookie : null;
    }

    /**
     * Validate and surface failures as the VALIDATION_ERROR envelope rather
     * than Laravel's default 422 shape.
     */
    private function validate(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            throw ApiException::validation('Request validation failed', [
                'issues' => $validator->errors()->toArray(),
            ]);
        }

        return $validator->validated();
    }

    private function roleLogin(Request $request, array $roles, string $forbiddenMessage): JsonResponse
    {
        $data = $this->validate($request, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'max:200'],
        ]);

        $email = mb_strtolower(trim($data['email']));
        $user = User::whereNull('deleted_at')->where('email', $email)->first();
        if ($user === null || $user->password_hash === null
            || ! $this->passwords->verify($data['password'], $user->password_hash)) {
            throw ApiException::unauthenticated('Invalid email or password');
        }
        if (! in_array((string) $user->admin_role, $roles, true)) {
            throw ApiException::forbidden($forbiddenMessage);
        }
        if ((string) $user->admin_role === 'partner' && $user->venue_id === null) {
            throw ApiException::forbidden('Owner account is not linked to a venue');
        }
        if ((string) $user->admin_role === 'coach') {
            $hasCoachProfile = DB::table('coaches')
                ->where('user_id', $user->id)
                ->where('is_active', true)
                ->exists();
            if (! $hasCoachProfile) {
                throw ApiException::forbidden('Coach account is not linked to an active coach profile');
            }
        }

        return $this->respondSession($this->tokens->issueSession($user, $request->userAgent()), 200);
    }

    /**
     * Build the AuthSession JSON response and attach the httpOnly auth cookies.
     *
     * The JSON body STILL contains access_token/refresh_token unchanged (the
     * mobile app reads them there); the cookies are purely additive for web
     * clients that send credentials:"include" and never touch the token in JS.
     * API routes do NOT run EncryptCookies, so the value travels raw — exactly
     * what the shared cookie contract requires.
     *
     * @param  array<string,mixed>  $session
     */
    private function respondSession(array $session, int $status): JsonResponse
    {
        $response = response()->json($session, $status);

        $domain = config('auth_tokens.cookie_domain');
        $secure = (bool) config('auth_tokens.cookie_secure');
        $accessTtl = (int) config('auth_tokens.access_ttl_seconds', 900);
        $refreshTtl = (int) config('auth_tokens.refresh_ttl_seconds', 30 * 86400);

        if (! empty($session['access_token'])) {
            $response->withCookie(new Cookie(
                'lf_access', (string) $session['access_token'],
                time() + $accessTtl, '/', $domain, $secure, true, false, Cookie::SAMESITE_LAX
            ));
        }
        if (! empty($session['refresh_token'])) {
            $response->withCookie(new Cookie(
                'lf_refresh', (string) $session['refresh_token'],
                time() + $refreshTtl, '/', $domain, $secure, true, false, Cookie::SAMESITE_LAX
            ));
        }

        return $response;
    }

    /** Queue expired lf_access/lf_refresh cookies (same domain+path) to clear them. */
    private function forgetSessionCookies(JsonResponse $response): JsonResponse
    {
        $domain = config('auth_tokens.cookie_domain');

        return $response
            ->withoutCookie('lf_access', '/', $domain)
            ->withoutCookie('lf_refresh', '/', $domain);
    }

    private function normalizeUsername(string $username): string
    {
        return mb_strtolower(trim($username));
    }

    private function isValidUsername(string $username): bool
    {
        return (bool) preg_match('/^[a-z0-9._]{3,40}$/', $username);
    }

    private function uniqueUsernameFromDisplayName(string $displayName): string
    {
        $base = Str::slug($displayName, '_');
        $base = preg_replace('/[^a-z0-9._]/', '', mb_strtolower($base)) ?: 'player';
        $base = substr($base, 0, 30);
        if (strlen($base) < 3) {
            $base = str_pad($base, 3, '0');
        }

        $candidate = $base;
        $suffix = 1;
        while (User::where('username', $candidate)->exists()) {
            $suffix += 1;
            $candidate = substr($base, 0, 40 - strlen((string) $suffix) - 1).'_'.$suffix;
        }

        return $candidate;
    }
}
