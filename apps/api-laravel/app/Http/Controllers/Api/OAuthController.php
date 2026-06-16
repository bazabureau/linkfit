<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Auth\TokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class OAuthController extends ApiController
{
    public function __construct(private readonly TokenService $tokens) {}

    public function google(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, ['id_token' => ['required', 'string', 'min:8', 'max:8192']]);
        $payload = Http::asForm()->get('https://oauth2.googleapis.com/tokeninfo', ['id_token' => $data['id_token']])->json();
        if (! is_array($payload) || empty($payload['sub']) || empty($payload['email'])) {
            return response()->json(['error' => ['code' => 'UNAUTHENTICATED', 'message' => 'Invalid Google token', 'request_id' => $request->attributes->get('request_id')]], 401);
        }
        $clientId = config('services.google.client_id');
        if ($clientId && ($payload['aud'] ?? null) !== $clientId) {
            return response()->json(['error' => ['code' => 'UNAUTHENTICATED', 'message' => 'Invalid Google audience', 'request_id' => $request->attributes->get('request_id')]], 401);
        }

        return response()->json($this->sessionForOAuth('google_sub', (string) $payload['sub'], (string) $payload['email'], (string) ($payload['name'] ?? explode('@', (string) $payload['email'])[0])));
    }

    public function apple(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'identity_token' => ['required', 'string', 'min:8', 'max:8192'],
            'name' => ['sometimes', 'array'],
        ]);
        $parts = explode('.', $data['identity_token']);
        $payload = count($parts) >= 2 ? json_decode(base64_decode(strtr($parts[1], '-_', '+/')) ?: '{}', true) : null;
        if (! is_array($payload) || empty($payload['sub']) || empty($payload['email'])) {
            return response()->json(['error' => ['code' => 'UNAUTHENTICATED', 'message' => 'Invalid Apple token', 'request_id' => $request->attributes->get('request_id')]], 401);
        }
        $clientId = config('services.apple.client_id');
        if ($clientId && ($payload['aud'] ?? null) !== $clientId) {
            return response()->json(['error' => ['code' => 'UNAUTHENTICATED', 'message' => 'Invalid Apple audience', 'request_id' => $request->attributes->get('request_id')]], 401);
        }
        $name = trim(((string) ($data['name']['first'] ?? '')).' '.((string) ($data['name']['last'] ?? '')));

        return response()->json($this->sessionForOAuth('apple_sub', (string) $payload['sub'], (string) $payload['email'], $name !== '' ? $name : explode('@', (string) $payload['email'])[0]));
    }

    private function sessionForOAuth(string $column, string $sub, string $email, string $displayName): array
    {
        $user = User::where($column, $sub)->whereNull('deleted_at')->first();
        if ($user === null) {
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
