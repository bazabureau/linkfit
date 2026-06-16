<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Auth\TokenService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

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
            'password' => ['required', 'string', 'min:12', 'max:200'],
            'display_name' => ['required', 'string', 'max:80'],
            'birth_date' => ['nullable', 'string', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
            'ref' => ['nullable', 'string', 'max:16'],
        ]);

        $email = mb_strtolower(trim($data['email']));
        $displayName = trim($data['display_name']);

        if ($displayName === '') {
            throw ApiException::validation('Display name is required');
        }
        // Password policy: at least one letter and one digit.
        if (! preg_match('/[A-Za-z]/', $data['password']) || ! preg_match('/\d/', $data['password'])) {
            throw ApiException::validation('Password must contain a letter and a digit');
        }

        if (User::where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }

        $user = new User;
        $user->email = $email;
        $user->password_hash = $this->passwords->hash($data['password']);
        $user->display_name = $displayName;
        if (! empty($data['birth_date'])) {
            $user->birth_date = $data['birth_date'];
        }
        $user->save();
        $token = $this->emailTokens->create($user->id, 'verify');
        $this->mail->emailVerification($user->email, $user->display_name ?: 'Linkfit user', $token);

        return response()->json($this->tokens->issueSession($user, $request->userAgent()), 201);
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

        // Constant-ish response: never reveal whether the email exists.
        if ($user === null || $user->password_hash === null
            || ! $this->passwords->verify($data['password'], $user->password_hash)) {
            throw ApiException::unauthenticated('Invalid email or password');
        }

        return response()->json($this->tokens->issueSession($user, $request->userAgent()), 200);
    }

    public function adminLogin(Request $request): JsonResponse
    {
        return $this->roleLogin($request, ['admin', 'moderator'], 'Admin access required');
    }

    public function ownerLogin(Request $request): JsonResponse
    {
        return $this->roleLogin($request, ['partner'], 'Owner access required');
    }

    /** POST /api/v1/auth/refresh → 200 AuthSession */
    public function refresh(Request $request): JsonResponse
    {
        $data = $this->validate($request, [
            'refresh_token' => ['required', 'string', 'min:10', 'max:200'],
        ]);

        return response()->json($this->tokens->refresh($data['refresh_token'], $request->userAgent()), 200);
    }

    /** POST /api/v1/auth/logout → 204 (idempotent) */
    public function logout(Request $request): JsonResponse
    {
        $data = $this->validate($request, [
            'refresh_token' => ['required', 'string', 'min:10', 'max:200'],
        ]);

        $this->tokens->revoke($data['refresh_token']);

        return response()->json(null, 204);
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

        return response()->json($this->tokens->issueSession($user, $request->userAgent()), 200);
    }
}
