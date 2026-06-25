<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AuthExtrasController extends ApiController
{
    public function __construct(
        private readonly PasswordService $passwords,
        private readonly EmailTokenService $emailTokens,
        private readonly TransactionalMailService $mail,
    ) {}

    public function sendVerification(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        if ($user->email_verified_at === null) {
            $code = $this->emailTokens->createCode($user->id, 'verify', 10);
            $this->mail->emailVerification($user->email, $user->display_name ?: 'Linkfit user', $code);
        }

        return response()->json([
            'sent' => $user->email_verified_at === null,
            'email' => $user->email,
            'expires_in_minutes' => $user->email_verified_at === null ? 10 : null,
        ]);
    }

    public function verifyEmail(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'email' => ['required_without:token', 'email'],
            'code' => ['required_without:token', 'string', 'regex:/^\d{6}$/'],
            'token' => ['required_without:code', 'string', 'min:6', 'max:200'],
        ]);

        // Atomic: consume the verification token and flip email_verified_at in
        // one transaction so a failure can't burn the token without verifying.
        DB::transaction(function () use ($data) {
            if (isset($data['email'], $data['code'])) {
                $user = User::where('email', strtolower($data['email']))->first();
                if ($user === null) {
                    throw ApiException::unauthenticated('Invalid or expired code');
                }
                $row = $this->emailTokens->consumeCodeForUser($user->id, 'verify', $data['code']);
            } else {
                $row = $this->emailTokens->consume($data['token'], 'verify');
            }

            DB::table('users')->where('id', $row->user_id)->update(['email_verified_at' => now(), 'updated_at' => now()]);
        });

        return response()->json(['verified' => true]);
    }

    public function requestPasswordReset(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, ['email' => ['required', 'email']]);
        $user = User::where('email', strtolower($data['email']))->first();
        if ($user !== null) {
            $code = $this->emailTokens->createCode($user->id, 'reset_password', 10);
            $this->mail->passwordReset($user->email, $user->display_name ?: 'Linkfit user', $code);
        }

        return response()->json(['requested' => true]);
    }

    public function verifyPasswordResetCode(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'email' => ['required', 'email'],
            'code' => ['required', 'string', 'regex:/^\d{6}$/'],
        ]);
        $user = User::where('email', strtolower($data['email']))->first();
        if ($user === null) {
            throw ApiException::unauthenticated('Invalid or expired code');
        }

        $this->emailTokens->verifyCodeForUser($user->id, 'reset_password', $data['code']);

        return response()->json(['verified' => true]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'email' => ['required_without:token', 'email'],
            'code' => ['required_without:token', 'string', 'regex:/^\d{6}$/'],
            'token' => ['required_without:code', 'string', 'min:6', 'max:200'],
            'password' => ['required_without:new_password', 'string', 'min:12', 'max:200'],
            'new_password' => ['required_without:password', 'string', 'min:12', 'max:200'],
        ]);
        $password = (string) ($data['password'] ?? $data['new_password']);
        // Enforce the same password policy as registration / change-password so a
        // reset can't set an all-letters or all-digits password.
        if (! preg_match('/[A-Za-z]/', $password) || ! preg_match('/\d/', $password)) {
            throw ApiException::validation('Password must contain at least one letter and one number');
        }

        // Atomic: consuming the reset code, rewriting the password hash, and
        // revoking live sessions must all commit together. Without the
        // transaction a mid-way failure could burn the code or leave stolen
        // sessions valid after the password changed.
        DB::transaction(function () use ($data, $password) {
            if (isset($data['email'], $data['code'])) {
                $user = User::where('email', strtolower($data['email']))->first();
                if ($user === null) {
                    throw ApiException::unauthenticated('Invalid or expired code');
                }
                $row = $this->emailTokens->consumeCodeForUser($user->id, 'reset_password', $data['code']);
            } else {
                $row = $this->emailTokens->consume($data['token'], 'reset_password');
            }
            DB::table('users')->where('id', $row->user_id)->update([
                'password_hash' => $this->passwords->hash($password),
                'updated_at' => now(),
            ]);

            // A password reset must lock out any already-stolen sessions: revoke
            // all of this user's live refresh tokens so old devices can't keep
            // refreshing.
            DB::table('refresh_tokens')
                ->where('user_id', $row->user_id)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
        });

        return response()->json(['reset' => true]);
    }
}
