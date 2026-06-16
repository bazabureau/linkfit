<?php

namespace App\Http\Controllers\Api;

use App\Services\Auth\PasswordService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MeController extends ApiController
{
    public function __construct(private readonly PasswordService $passwords) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->authUser($request)->toPublicUser());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'home_lat' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'home_lng' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
        ]);

        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        if (array_key_exists('home_lat', $data) xor array_key_exists('home_lng', $data)) {
            throw ApiException::validation('home_lat and home_lng must be provided together');
        }

        $user = $this->authUser($request);
        foreach ($data as $key => $value) {
            $user->{$key} = $value;
        }
        $user->save();

        return response()->json($user->fresh()->toPublicUser());
    }

    public function changePassword(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'current_password' => ['required', 'string', 'max:200'],
            'password' => ['required', 'string', 'min:12', 'max:200'],
        ]);
        if ($user->password_hash === null || ! $this->passwords->verify($data['current_password'], $user->password_hash)) {
            throw ApiException::unauthenticated('Current password is invalid');
        }
        $this->assertPasswordPolicy($data['password']);
        DB::table('users')->where('id', $user->id)->update([
            'password_hash' => $this->passwords->hash($data['password']),
            'updated_at' => now(),
        ]);
        $familyId = $request->attributes->get('auth_family_id');
        $tokens = DB::table('refresh_tokens')
            ->where('user_id', $user->id)
            ->whereNull('revoked_at');
        if ($familyId !== null) {
            $tokens->where('family_id', '!=', $familyId);
        }
        $tokens->update(['revoked_at' => now()]);

        return response()->json(['changed' => true]);
    }

    public function changeEmail(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'current_password' => ['required', 'string', 'max:200'],
        ]);
        if ($user->password_hash === null || ! $this->passwords->verify($data['current_password'], $user->password_hash)) {
            throw ApiException::unauthenticated('Current password is invalid');
        }
        $email = mb_strtolower(trim($data['email']));
        $exists = DB::table('users')
            ->where('email', $email)
            ->where('id', '!=', $user->id)
            ->whereNull('deleted_at')
            ->exists();
        if ($exists) {
            throw ApiException::conflict('Email is already in use');
        }
        if ($email === mb_strtolower((string) $user->email)) {
            return response()->json($user->fresh()->toPublicUser());
        }

        DB::table('users')->where('id', $user->id)->update([
            'email' => $email,
            'email_verified_at' => null,
            'updated_at' => now(),
        ]);

        return response()->json($user->fresh()->toPublicUser());
    }

    public function sessions(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $familyId = $request->attributes->get('auth_family_id');

        $rows = DB::table('refresh_tokens')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(100)
            ->get()
            ->map(fn ($r) => [
                'id' => $r->id,
                'family_id' => $r->family_id,
                'created_at' => $this->iso($r->created_at),
                'expires_at' => $this->iso($r->expires_at),
                'revoked_at' => $this->iso($r->revoked_at),
                'user_agent' => $r->user_agent ?? null,
                'last_used_at' => $this->iso($r->last_used_at ?? null),
                'is_current' => $familyId !== null && $r->family_id === $familyId,
            ]);

        return response()->json(['items' => $rows]);
    }

    public function deleteSession(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        DB::table('refresh_tokens')
            ->where('user_id', $user->id)
            ->where('id', $id)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        return response()->json(null, 204);
    }

    public function deleteOtherSessions(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $familyId = $request->attributes->get('auth_family_id');
        $query = DB::table('refresh_tokens')
            ->where('user_id', $user->id)
            ->whereNull('revoked_at');
        if ($familyId !== null) {
            $query->where('family_id', '!=', $familyId);
        }
        $query->update(['revoked_at' => now()]);

        return response()->json(null, 204);
    }

    public function deviceList(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        $items = DB::table('device_tokens')
            ->where('user_id', $user->id)
            ->orderByDesc('last_seen')
            ->limit(100)
            ->get()
            ->map(fn ($device) => [
                'id' => (string) $device->id,
                'platform' => $device->platform,
                'token_preview' => $this->tokenPreview((string) $device->token),
                'last_seen' => $this->iso($device->last_seen),
                'revoked_at' => $this->iso($device->revoked_at),
                'created_at' => $this->iso($device->created_at),
                'active' => $device->revoked_at === null,
            ])
            ->values();

        return response()->json(['items' => $items]);
    }

    public function devices(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'token' => ['required', 'string', 'max:512'],
            'platform' => ['required', 'in:ios,android'],
        ]);

        DB::table('device_tokens')->updateOrInsert(
            ['user_id' => $user->id, 'token' => $data['token']],
            [
                'platform' => $data['platform'],
                'last_seen' => now(),
                'revoked_at' => null,
                'created_at' => now(),
            ],
        );

        return response()->json(['ok' => true]);
    }

    public function deleteDevice(Request $request, string $idOrToken): JsonResponse
    {
        $user = $this->authUser($request);
        DB::table('device_tokens')
            ->where('user_id', $user->id)
            ->where(function ($query) use ($idOrToken) {
                $query->where('id', $idOrToken)->orWhere('token', $idOrToken);
            })
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        return response()->json(null, 204);
    }

    private function tokenPreview(string $token): string
    {
        if (strlen($token) <= 14) {
            return $token;
        }

        return substr($token, 0, 6).'...'.substr($token, -6);
    }

    private function assertPasswordPolicy(string $password): void
    {
        if (! preg_match('/[A-Za-z]/', $password) || ! preg_match('/\d/', $password)) {
            throw ApiException::validation('Password must contain at least one letter and one number');
        }
    }
}
