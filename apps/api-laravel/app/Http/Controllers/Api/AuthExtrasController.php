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
            $token = $this->emailTokens->create($user->id, 'verify');
            $this->mail->emailVerification($user->email, $user->display_name ?: 'Linkfit user', $token);
        }

        return response()->json(['sent' => $user->email_verified_at === null]);
    }

    public function verifyEmail(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, ['token' => ['required', 'string', 'min:10', 'max:200']]);
        $row = $this->emailTokens->consume($data['token'], 'verify');
        DB::table('users')->where('id', $row->user_id)->update(['email_verified_at' => now(), 'updated_at' => now()]);

        return response()->json(['verified' => true]);
    }

    public function requestPasswordReset(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, ['email' => ['required', 'email']]);
        $user = User::where('email', strtolower($data['email']))->first();
        if ($user !== null) {
            $token = $this->emailTokens->create($user->id, 'reset_password', 60);
            $this->mail->passwordReset($user->email, $user->display_name ?: 'Linkfit user', $token);
        }

        return response()->json(['requested' => true]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'token' => ['required', 'string', 'min:10', 'max:200'],
            'password' => ['required', 'string', 'min:12', 'max:200'],
        ]);
        $row = $this->emailTokens->consume($data['token'], 'reset_password');
        DB::table('users')->where('id', $row->user_id)->update([
            'password_hash' => $this->passwords->hash($data['password']),
            'updated_at' => now(),
        ]);

        // A password reset must lock out any already-stolen sessions: revoke all
        // of this user's live refresh tokens so old devices can't keep refreshing.
        DB::table('refresh_tokens')
            ->where('user_id', $row->user_id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        return response()->json(['reset' => true]);
    }
}
