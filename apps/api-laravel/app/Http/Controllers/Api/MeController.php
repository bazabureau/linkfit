<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ValidatesMediaUrls;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use App\Services\Notifications\PushDispatcher;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MeController extends ApiController
{
    use ValidatesMediaUrls;

    public function __construct(
        private readonly PasswordService $passwords,
        private readonly EmailTokenService $emailTokens,
        private readonly TransactionalMailService $mail,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->authUser($request)->toPublicUser());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'phone' => ['sometimes', 'nullable', 'string', 'min:7', 'max:40', 'regex:/^\+?[0-9\s().-]{7,40}$/'],
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
        // `min:1` counts characters, so a whitespace-only string passes and would
        // store a blank display_name that is then served to every other user.
        // Reject it (the value itself is left unmutated for valid names).
        if (array_key_exists('display_name', $data) && trim((string) $data['display_name']) === '') {
            throw ApiException::validation('display_name cannot be blank');
        }
        // photo_url is served verbatim to other users, so a free URL must be https
        // and on an allowlisted host (the validated upload path / a media_asset_id
        // is preferred). A null clears the avatar and skips the host check.
        // Normalize blank/whitespace-only input to null so an empty string can
        // never be stored and served to other users unvalidated.
        if (array_key_exists('photo_url', $data)) {
            $data['photo_url'] = trim((string) $data['photo_url']) ?: null;
            if ($data['photo_url'] !== null) {
                $data['photo_url'] = $this->assertAllowedMediaUrl($data['photo_url']);
            }
        }

        $user = $this->authUser($request);
        foreach ($data as $key => $value) {
            $user->{$key} = $value;
        }
        $user->save();

        return response()->json($user->fresh()->toPublicUser());
    }

    public function avatar(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $file = $request->file('file') ?: $request->file('avatar');

        if ($file === null) {
            $data = $this->validateBody($request, [
                'media_asset_id' => ['sometimes', 'nullable', 'uuid'],
                'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048', 'required_without:media_asset_id'],
            ]);
            // Prefer a server-owned media_asset_id; otherwise the free URL must be
            // https + allowlisted host. The value is served to all other users.
            $user->photo_url = ! empty($data['media_asset_id'])
                ? $this->resolveOwnedMediaAssetUrl((string) $data['media_asset_id'], (string) $user->id)
                : $this->assertAllowedMediaUrl((string) $data['photo_url']);
            $user->save();

            return response()->json(['user' => $user->fresh()->toPublicUser(), 'media' => null]);
        }

        if (! $file->isValid()) {
            throw ApiException::validation('Invalid avatar upload');
        }
        if ($file->getSize() > 6 * 1024 * 1024) {
            throw ApiException::validation('Avatar file is too large');
        }
        $mime = (string) $file->getMimeType();
        if (! in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw ApiException::validation('Only jpeg, png and webp images are allowed');
        }
        $info = @getimagesize($file->getRealPath());
        if ($info === false) {
            throw ApiException::validation('Invalid image file');
        }

        [$width, $height] = $info;
        [$contents, $width, $height] = $this->compressedAvatarImage($file->getRealPath(), $mime, $width, $height);
        $disk = env('MEDIA_DISK', config('filesystems.default') === 's3' ? 's3' : 'public');
        $extension = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
        $path = 'avatars/'.now()->format('Y/m').'/'.Str::uuid().'.'.$extension;
        Storage::disk($disk)->put($path, $contents, ['visibility' => 'public']);
        $url = Storage::disk($disk)->url($path);
        $mediaId = (string) Str::uuid();

        DB::table('media_assets')->insert([
            'id' => $mediaId,
            'user_id' => $user->id,
            'disk' => $disk,
            'path' => $path,
            'url' => $url,
            'mime' => $mime,
            'size_bytes' => strlen($contents),
            'width' => $width,
            'height' => $height,
            'purpose' => 'avatar',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user->photo_url = $url;
        $user->save();

        return response()->json([
            'user' => $user->fresh()->toPublicUser(),
            'media' => ['id' => $mediaId, 'url' => $url, 'width' => $width, 'height' => $height, 'mime' => $mime],
        ], 201);
    }

    public function deleteAvatar(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $user->photo_url = null;
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

        // Email is a credential/identity change and a classic account-takeover
        // lever, so — exactly like changePassword — revoke every OTHER refresh
        // family while keeping the caller's current session alive.
        $familyId = $request->attributes->get('auth_family_id');
        $tokens = DB::table('refresh_tokens')
            ->where('user_id', $user->id)
            ->whereNull('revoked_at');
        if ($familyId !== null) {
            $tokens->where('family_id', '!=', $familyId);
        }
        $tokens->update(['revoked_at' => now()]);

        // Changing the email resets verification, so issue a fresh 6-digit code
        // to the NEW address — otherwise the account is left unverified with no
        // way to confirm it short of a separate /auth/send-verification call.
        // Best-effort: a mail hiccup must not fail the (already-committed) change.
        $verificationEmailSent = true;
        try {
            $code = $this->emailTokens->createCode($user->id, 'verify', 10);
            $this->mail->emailVerification($email, $user->display_name ?: 'Linkfit user', $code);
        } catch (\Throwable $e) {
            // Swallow — the user can re-request via POST /auth/send-verification.
            // Surface the failure to monitoring and tell the client so it can
            // prompt the user to retry verification later.
            report($e);
            $verificationEmailSent = false;
        }

        return response()->json($user->fresh()->toPublicUser() + ['verification_email_sent' => $verificationEmailSent]);
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
                // `last_seen_at` mirrors `last_seen` under the key the mobile
                // devices screen reads first — without it the app falls through
                // to `created_at` and shows the registration time as "last active".
                'last_seen_at' => $this->iso($device->last_seen),
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

        // The app calls this on every launch, so two concurrent launches can race
        // on the same (user, token). A read-then-write (exists()+insert()) lets both
        // miss and both insert, and the `device_tokens_user_token_uq` unique index
        // then turns the loser into a 500. An atomic upsert keyed on that index is
        // race-safe and replay-safe, and compiles to `ON CONFLICT` on both Postgres
        // (prod) and SQLite (tests).
        //
        // `created_at` is intentionally omitted from the conflict-update list so the
        // original registration date is preserved on re-registration — only the
        // mutable columns (platform, last_seen, revoked_at) are refreshed.
        DB::table('device_tokens')->upsert(
            [[
                'user_id' => $user->id,
                'token' => $data['token'],
                'platform' => $data['platform'],
                'last_seen' => now(),
                'revoked_at' => null,
                'created_at' => now(),
            ]],
            ['user_id', 'token'],
            ['platform', 'last_seen', 'revoked_at'],
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

    public function testPush(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'title' => ['nullable', 'string', 'max:120'],
            'body' => ['nullable', 'string', 'max:240'],
            'send_now' => ['nullable', 'boolean'],
        ]);

        $activeDevices = DB::table('device_tokens')
            ->where('user_id', $user->id)
            ->whereNull('revoked_at')
            ->count();

        if (! Schema::hasTable('push_notification_jobs')) {
            throw ApiException::internal('Push jobs are not configured', 503);
        }

        $jobId = (string) Str::uuid();
        DB::table('push_notification_jobs')->insert([
            'id' => $jobId,
            'user_id' => $user->id,
            'type' => 'system',
            'title' => $data['title'] ?? 'Linkfit test',
            'body' => $data['body'] ?? 'Push notifications are working.',
            'payload' => json_encode(['kind' => 'test_push']),
            'status' => 'pending',
            'available_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $dispatch = null;
        if (($data['send_now'] ?? true) === true) {
            $dispatch = app(PushDispatcher::class)->process(100);
        }

        return response()->json([
            'queued' => true,
            'job_id' => $jobId,
            'active_devices' => $activeDevices,
            'can_receive' => $activeDevices > 0,
            'dispatch' => $dispatch,
        ], 201);
    }

    private function tokenPreview(string $token): string
    {
        if (strlen($token) <= 14) {
            return $token;
        }

        return substr($token, 0, 6).'...'.substr($token, -6);
    }

    /**
     * @return array{0:string,1:int,2:int}
     */
    private function compressedAvatarImage(string $path, string $mime, int $width, int $height): array
    {
        if (! function_exists('imagecreatefromstring')) {
            return [(string) file_get_contents($path), $width, $height];
        }

        $source = @imagecreatefromstring((string) file_get_contents($path));
        if ($source === false) {
            throw ApiException::validation('Invalid image file');
        }

        $maxDimension = 900;
        $ratio = min(1, $maxDimension / max($width, $height));
        $targetWidth = max(1, (int) round($width * $ratio));
        $targetHeight = max(1, (int) round($height * $ratio));
        $image = $source;

        if ($targetWidth !== $width || $targetHeight !== $height) {
            $image = imagecreatetruecolor($targetWidth, $targetHeight);
            if (in_array($mime, ['image/png', 'image/webp'], true)) {
                imagealphablending($image, false);
                imagesavealpha($image, true);
                $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
                imagefilledrectangle($image, 0, 0, $targetWidth, $targetHeight, $transparent);
            }
            imagecopyresampled($image, $source, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
            imagedestroy($source);
        }

        ob_start();
        if ($mime === 'image/png') {
            imagepng($image, null, 8);
        } elseif ($mime === 'image/webp' && function_exists('imagewebp')) {
            imagewebp($image, null, 82);
        } else {
            imageinterlace($image, true);
            imagejpeg($image, null, 84);
        }
        $contents = (string) ob_get_clean();
        imagedestroy($image);

        return [$contents, $targetWidth, $targetHeight];
    }

    private function assertPasswordPolicy(string $password): void
    {
        if (! preg_match('/[A-Za-z]/', $password) || ! preg_match('/\d/', $password)) {
            throw ApiException::validation('Password must contain at least one letter and one number');
        }
    }
}
