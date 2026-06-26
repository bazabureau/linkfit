<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PreferencesController extends ApiController
{
    /** Valid values of the `notification_type` Postgres enum — the only types
     *  that can be written to notification_preferences.type. Anything else
     *  (e.g. a client category key like "games") would crash the enum insert. */
    private const NOTIFICATION_TYPES = [
        'game_joined', 'game_cancelled', 'game_reminder', 'no_show_marked',
        'rating_received', 'tournament_invite', 'message_received', 'system',
    ];

    public function show(Request $request): JsonResponse
    {
        $auth = $this->authUser($request);
        // Re-read the row so the response reflects writes made earlier in the
        // same request (quiet hours / daily digest / time zone), not stale state.
        $user = DB::table('users')->where('id', $auth->id)->first() ?? $auth;

        $quietStart = isset($user->quiet_hours_start) ? (int) $user->quiet_hours_start : null;
        $quietEnd = isset($user->quiet_hours_end) ? (int) $user->quiet_hours_end : null;

        $rows = DB::table('notification_preferences')->where('user_id', $user->id)->get();

        return response()->json([
            // iOS NotificationPreferencesResponse.preferences is a flat ARRAY
            // of {type, push_enabled, email_enabled, in_app_enabled}.
            'preferences' => $rows->map(fn ($r) => [
                'type' => $r->type,
                'push_enabled' => (bool) $r->push_enabled,
                'email_enabled' => (bool) $r->email_enabled,
                'in_app_enabled' => (bool) $r->in_app_enabled,
            ])->values(),
            // Flat {type: push_enabled} map for clients that read a simple
            // boolean map (mobile reads `notification_preferences`).
            'notification_preferences' => $rows->mapWithKeys(fn ($r) => [
                $r->type => (bool) $r->push_enabled,
            ])->all() ?: (object) [],
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

        // iOS form: {preferences: {type: {push_enabled, email_enabled, in_app_enabled}}}.
        foreach ((array) $request->input('preferences', []) as $type => $pref) {
            // Skip anything that isn't a real notification_type enum value — an
            // unknown key would throw on the enum insert and 500 the request.
            if (! in_array($type, self::NOTIFICATION_TYPES, true) || ! is_array($pref) || ! array_key_exists('push_enabled', $pref)) {
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

        // Flat form (mobile): top-level {type: bool} pairs toggle push_enabled.
        // Email/in-app default to enabled for newly-created rows.
        foreach ((array) $request->all() as $type => $value) {
            // Only real notification_type enum values are valid keys here.
            if (! in_array($type, self::NOTIFICATION_TYPES, true) || ! is_scalar($value)) {
                continue;
            }
            $enabled = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($enabled === null) {
                continue;
            }
            $exists = DB::table('notification_preferences')
                ->where('user_id', $user->id)->where('type', $type)->exists();
            DB::table('notification_preferences')->updateOrInsert(
                ['user_id' => $user->id, 'type' => $type],
                $exists
                    ? ['push_enabled' => $enabled, 'updated_at' => now()]
                    : ['push_enabled' => $enabled, 'email_enabled' => true, 'in_app_enabled' => true, 'updated_at' => now()],
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
        // `users.time_zone` is NOT NULL — only overwrite it when the client
        // actually sends one (otherwise the digest toggle would crash).
        $update = ['daily_digest_enabled' => $data['enabled'], 'updated_at' => now()];
        if (! empty($data['time_zone'])) {
            // Only persist a parseable zone — an unparseable value would corrupt
            // the NOT NULL users.time_zone column that the digest cron feeds into
            // `new DateTimeZone()`. Accepts any value PHP can parse (IANA names /
            // offsets), so currently-valid clients are unaffected.
            try {
                new \DateTimeZone((string) $data['time_zone']);
                $update['time_zone'] = $data['time_zone'];
            } catch (\Throwable $e) {
                throw \App\Support\ApiException::validation('Invalid time_zone');
            }
        }
        DB::table('users')->where('id', $this->authUser($request)->id)->update($update);

        return $this->show($request);
    }
}
