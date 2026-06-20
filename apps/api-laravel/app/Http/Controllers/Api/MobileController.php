<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Membership\MembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MobileController extends ApiController
{
    public function authCheck(Request $request): JsonResponse
    {
        $data = $this->validateQuery($request, [
            'email' => ['nullable', 'string', 'email', 'max:254'],
            'username' => ['nullable', 'string', 'max:40'],
        ]);

        $email = isset($data['email']) ? mb_strtolower(trim($data['email'])) : null;
        $username = isset($data['username']) ? $this->normalizeUsername((string) $data['username']) : null;

        return response()->json([
            'email' => $email !== null ? [
                'value' => $email,
                'available' => ! User::where('email', $email)->exists(),
            ] : null,
            'username' => $username !== null ? [
                'value' => $username,
                'valid' => $this->isValidUsername($username),
                'available' => $this->isValidUsername($username)
                    && ! DB::table('users')->where('username', $username)->exists(),
            ] : null,
        ]);
    }

    public function config(): JsonResponse
    {
        return response()->json($this->mobileConfig());
    }

    public function bootstrap(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $membership = app(MembershipService::class);

        return response()->json([
            'me' => $user->toPublicUser(),
            'config' => $this->mobileConfig(),
            'access' => $this->accessPayload((string) $user->id, $membership),
            'unread_counts' => $this->unreadCounts((string) $user->id),
            'notification_preferences' => $this->notificationPreferences((string) $user->id),
            'announcement' => $this->announcement((string) $user->id, (string) $request->query('locale', 'az')),
            'server_time' => now()->toIso8601ZuluString('millisecond'),
        ]);
    }

    public function resolveLink(Request $request): JsonResponse
    {
        $data = $this->validateQuery($request, [
            'url' => ['required', 'string', 'max:2048'],
        ]);

        $path = trim((string) parse_url($data['url'], PHP_URL_PATH), '/');
        if ($path === '') {
            return response()->json(['type' => 'home', 'screen' => 'home', 'params' => (object) []]);
        }

        $segments = array_values(array_filter(explode('/', $path), fn ($p) => $p !== ''));
        if (isset($segments[0]) && in_array($segments[0], ['az', 'en', 'ru'], true)) {
            array_shift($segments);
        }
        $first = $segments[0] ?? '';
        $second = $segments[1] ?? null;

        if ($first === 'r' && $second !== null) {
            return response()->json([
                'type' => 'referral',
                'screen' => 'register',
                'params' => ['ref' => strtoupper($second)],
            ]);
        }

        $map = [
            'games' => ['type' => 'game', 'screen' => 'game_detail', 'table' => 'games'],
            'tournaments' => ['type' => 'tournament', 'screen' => 'tournament_detail', 'table' => 'tournaments'],
            'users' => ['type' => 'user', 'screen' => 'profile', 'table' => 'users'],
            'venues' => ['type' => 'venue', 'screen' => 'venue_detail', 'table' => 'venues'],
            'stories' => ['type' => 'story', 'screen' => 'story_detail', 'table' => 'stories'],
        ];

        if (isset($map[$first]) && $second !== null) {
            $target = $map[$first];
            $exists = DB::table($target['table'])->where('id', $second)->exists();

            return response()->json([
                'type' => $target['type'],
                'screen' => $target['screen'],
                'exists' => $exists,
                'params' => ['id' => $second],
            ]);
        }

        return response()->json([
            'type' => 'unknown',
            'screen' => null,
            'params' => ['path' => $path],
        ]);
    }

    private function mobileConfig(): array
    {
        $membership = app(MembershipService::class);

        return [
            'app' => [
                'brand' => 'LinkFit',
                'environment' => app()->environment(),
                'server_time' => now()->toIso8601ZuluString('millisecond'),
            ],
            'api' => [
                'version' => 'v1',
                'base_url' => rtrim((string) config('app.url'), '/'),
                'media_base_url' => rtrim((string) config('app.url'), '/').'/storage',
                'requires_app_key' => (bool) config('app.require_api_key'),
            ],
            'ios' => [
                'latest_build' => (int) config('services.linkfit.ios_latest_build', 13),
                'latest_version' => (string) config('services.linkfit.latest_version', '1.0.0'),
                'min_supported_build' => (int) config('services.linkfit.ios_min_supported_build', 1),
                'force_update' => (bool) config('services.linkfit.ios_force_update', false),
                'release_notes_url' => config('services.linkfit.ios_release_notes_url'),
            ],
            'support' => [
                'email' => config('services.linkfit.support_email', 'support@linkfit.az'),
                'web_url' => config('services.linkfit.web_url'),
            ],
            'access' => [
                'full_access' => true,
                'features' => $membership->publicFeaturesForTier('premium'),
            ],
            'features' => [
                'apple_login' => filled(config('services.apple.client_id')),
                'google_login' => filled(config('services.google.client_ids')),
                'media_upload' => true,
                'push_notifications' => true,
                'stories' => true,
                'bookings' => true,
                'payments' => false,
                'membership' => false,
                'premium' => false,
                'free_launch_access' => true,
                'deep_links' => true,
                'user_reporting' => true,
                'content_reporting' => true,
                'user_blocking' => true,
                'blocked_users_management' => true,
                'account_deletion' => true,
                'account_data_export' => true,
                'content_deletion' => true,
                'moderation_review' => true,
            ],
        ];
    }

    private function accessPayload(string $userId, MembershipService $membership): array
    {
        $state = $membership->resolve($userId);

        return [
            'full_access' => $state->is_premium,
            'features' => $membership->publicFeaturesForUser($userId),
        ];
    }

    private function unreadCounts(string $userId): array
    {
        $messages = DB::table('conversation_participants as me')
            ->join('conversations as c', 'c.id', '=', 'me.conversation_id')
            ->where('me.user_id', $userId)
            ->whereNull('me.left_at')
            ->whereNotNull('c.last_message_at')
            ->where(fn ($q) => $q->whereNull('me.last_read_at')->orWhereColumn('c.last_message_at', '>', 'me.last_read_at'))
            ->count();

        $notifications = DB::table('notifications')
            ->where('user_id', $userId)
            ->whereNull('read_at')
            ->count();

        $invites = DB::table('game_invitations')
            ->where('invitee_user_id', $userId)
            ->where('status', 'pending')
            ->count();

        return [
            'messages' => $messages,
            'notifications' => $notifications,
            'invites' => $invites,
            'total' => $messages + $notifications + $invites,
        ];
    }

    private function notificationPreferences(string $userId): array
    {
        $user = DB::table('users')->where('id', $userId)->first();
        $rows = DB::table('notification_preferences')->where('user_id', $userId)->get();

        return [
            'preferences' => $rows->map(fn ($r) => [
                'type' => $r->type,
                'push_enabled' => (bool) $r->push_enabled,
                'email_enabled' => (bool) $r->email_enabled,
                'in_app_enabled' => (bool) $r->in_app_enabled,
            ])->values(),
            'notification_preferences' => $rows->mapWithKeys(fn ($r) => [
                $r->type => (bool) $r->push_enabled,
            ])->all() ?: (object) [],
            'quiet_hours_start' => $user?->quiet_hours_start !== null ? (int) $user->quiet_hours_start : null,
            'quiet_hours_end' => $user?->quiet_hours_end !== null ? (int) $user->quiet_hours_end : null,
            'daily_digest_enabled' => (bool) ($user?->daily_digest_enabled ?? true),
            'time_zone' => $user?->time_zone ?? null,
        ];
    }

    private function announcement(string $userId, string $locale): ?object
    {
        return DB::table('announcements as a')
            ->where('a.starts_at', '<=', now())
            ->where(fn ($q) => $q->whereNull('a.ends_at')->orWhere('a.ends_at', '>', now()))
            ->whereIn('a.audience', ['all', $locale])
            ->whereNotExists(function ($q) use ($userId) {
                $q->selectRaw('1')
                    ->from('user_dismissed_announcements as d')
                    ->whereColumn('d.announcement_id', 'a.id')
                    ->where('d.user_id', $userId);
            })
            ->orderBy('a.priority')
            ->orderByDesc('a.starts_at')
            ->first();
    }

    private function normalizeUsername(string $username): string
    {
        return mb_strtolower(trim($username));
    }

    private function isValidUsername(string $username): bool
    {
        return (bool) preg_match('/^[a-z0-9._]{3,40}$/', $username);
    }
}
