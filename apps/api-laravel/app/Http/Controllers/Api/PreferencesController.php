<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PreferencesController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        $quietStart = isset($user->quiet_hours_start) ? (int) $user->quiet_hours_start : null;
        $quietEnd = isset($user->quiet_hours_end) ? (int) $user->quiet_hours_end : null;

        return response()->json([
            // iOS NotificationPreferencesResponse.preferences is a flat ARRAY
            // of {type, push_enabled, email_enabled, in_app_enabled}.
            'preferences' => DB::table('notification_preferences')->where('user_id', $user->id)->get()->map(fn ($r) => [
                'type' => $r->type,
                'push_enabled' => (bool) $r->push_enabled,
                'email_enabled' => (bool) $r->email_enabled,
                'in_app_enabled' => (bool) $r->in_app_enabled,
            ])->values(),
            // iOS reads these top-level optional Int? keys directly.
            'quiet_hours_start' => $quietStart,
            'quiet_hours_end' => $quietEnd,
            // Kept for any non-iOS consumer of the nested object.
            'quiet_hours' => [
                'start' => $quietStart,
                'end' => $quietEnd,
            ],
            'daily_digest_enabled' => (bool) ($user->daily_digest_enabled ?? true),
            'time_zone' => $user->time_zone ?? null,
        ]);
    }

    public function patch(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        foreach ((array) $request->input('preferences', []) as $type => $pref) {
            if (! is_array($pref) || ! array_key_exists('push_enabled', $pref)) {
                continue;
            }
            DB::table('notification_preferences')->updateOrInsert(
                ['user_id' => $user->id, 'type' => $type],
                [
                    'push_enabled' => (bool) $pref['push_enabled'],
                    'email_enabled' => (bool) ($pref['email_enabled'] ?? true),
                    'in_app_enabled' => (bool) ($pref['in_app_enabled'] ?? true),
                    'updated_at' => now(),
                ],
            );
        }

        return $this->show($request);
    }

    public function quietHours(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'start' => ['nullable', 'integer', 'min:0', 'max:23'],
            'end' => ['nullable', 'integer', 'min:0', 'max:23'],
        ]);
        DB::table('users')->where('id', $this->authUser($request)->id)->update([
            'quiet_hours_start' => $data['start'] ?? null,
            'quiet_hours_end' => $data['end'] ?? null,
            'updated_at' => now(),
        ]);

        return $this->show($request);
    }

    public function dailyDigest(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'enabled' => ['required', 'boolean'],
            'time_zone' => ['nullable', 'string', 'max:80'],
        ]);
        DB::table('users')->where('id', $this->authUser($request)->id)->update([
            'daily_digest_enabled' => $data['enabled'],
            'time_zone' => $data['time_zone'] ?? null,
            'updated_at' => now(),
        ]);

        return $this->show($request);
    }
}
