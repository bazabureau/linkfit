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
        $subscriptionsEnabled = $membership->publicSubscriptionsEnabled();
        $payments = $membership->paymentState();
        $paymentsEnabled = $subscriptionsEnabled && (bool) $payments['enabled'];

        $payload = [
            'app' => [
                'brand' => 'LinkFit',
                'environment' => app()->environment(),
                'server_time' => now()->toIso8601ZuluString('millisecond'),
            ],
            'api' => [
                'version' => 'v1',
                'base_url' => rtrim((string) config('app.url'), '/'),
                'media_base_url' => rtrim((string) config('app.url'), '/').'/storage',
                'auth_scheme' => 'Bearer',
                'user_auth_required_for_private_actions' => true,
            ],
            'endpoints' => $this->mobileEndpoints($subscriptionsEnabled, $paymentsEnabled),
            'contracts' => $this->mobileContracts($paymentsEnabled),
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
            'access' => $this->configAccessPayload($membership, $subscriptionsEnabled),
            'features' => [
                'apple_login' => filled(config('services.apple.client_id')),
                'google_login' => filled(config('services.google.client_ids')),
                'media_upload' => true,
                'push_notifications' => true,
                'stories' => true,
                'bookings' => true,
                'payments' => $paymentsEnabled,
                'membership' => $subscriptionsEnabled,
                'premium' => $subscriptionsEnabled,
                'free_launch_access' => ! $subscriptionsEnabled,
                'deep_links' => true,
                'user_reporting' => true,
                'content_reporting' => true,
                'user_blocking' => true,
                'blocked_users_management' => true,
                'account_deletion' => true,
                'account_data_export' => true,
                'content_deletion' => true,
                'moderation_review' => true,
                'players_directory' => true,
                'player_profiles' => true,
                'follow_graph' => true,
                'messaging' => true,
                'group_messaging' => true,
                'typing_indicators' => true,
                'unread_counts' => true,
                'voice_messages' => true,
                'video_messages' => true,
                'lessons' => true,
                'tournaments' => true,
                'squads' => true,
                'referrals' => true,
                'saved_places' => true,
                'support_tickets' => true,
                'owner_applications' => true,
                'analytics_events' => true,
            ],
        ];

        if ($subscriptionsEnabled) {
            $payload['membership'] = [
                'plans' => $membership->featureMatrix(),
                'payments' => $payments,
            ];
        }

        return $payload;
    }

    private function mobileEndpoints(bool $subscriptionsEnabled, bool $paymentsEnabled): array
    {
        $endpoints = [
            'app' => [
                'config' => '/api/v1/mobile/config',
                'bootstrap' => '/api/v1/mobile/bootstrap',
                'version' => '/api/v1/app/version',
                'metadata' => '/api/v1/app/metadata',
                'capabilities' => '/api/v1/app/capabilities',
                'resolve_link' => '/api/v1/links/resolve?url={url}',
                'analytics_events' => '/api/v1/analytics/events',
            ],
            'auth' => [
                'check' => '/api/v1/auth/check?email={email}&username={username}',
                'register' => '/api/v1/auth/register',
                'login' => '/api/v1/auth/login',
                'refresh' => '/api/v1/auth/refresh',
                'logout' => '/api/v1/auth/logout',
                'send_verification' => '/api/v1/auth/send-verification',
                'verify_email' => '/api/v1/auth/verify-email',
                'request_password_reset' => '/api/v1/auth/request-password-reset',
                'verify_password_reset_code' => '/api/v1/auth/verify-password-reset-code',
                'reset_password' => '/api/v1/auth/reset-password',
                'apple' => '/api/v1/auth/apple',
                'google' => '/api/v1/auth/google',
            ],
            'me' => [
                'profile' => '/api/v1/me',
                'update_profile' => '/api/v1/me',
                'avatar' => '/api/v1/me/avatar',
                'change_password' => '/api/v1/me/change-password',
                'change_email' => '/api/v1/me/change-email',
                'sessions' => '/api/v1/me/sessions',
                'devices' => '/api/v1/me/devices',
                'notification_preferences' => '/api/v1/me/notification-preferences',
                'quiet_hours' => '/api/v1/me/notification-preferences/quiet-hours',
                'daily_digest' => '/api/v1/me/notification-preferences/daily-digest',
                'home' => '/api/v1/me/home',
                'agenda' => '/api/v1/me/agenda',
                'activity' => '/api/v1/me/activity',
                'insights' => '/api/v1/me/insights',
                'unread_counts' => '/api/v1/me/unread-counts',
                'delete_request' => '/api/v1/me/delete',
                'delete_cancel' => '/api/v1/me/delete/cancel',
                'data_export' => '/api/v1/me/data-export',
                'medical_profile' => '/api/v1/me/medical-profile',
            ],
            'social' => [
                'players' => '/api/v1/players?q={query}&limit={limit}',
                'profile' => '/api/v1/users/{id}/profile',
                'followers' => '/api/v1/users/{id}/followers?limit={limit}&offset={offset}',
                'following' => '/api/v1/users/{id}/following?limit={limit}&offset={offset}',
                'follow' => '/api/v1/users/{id}/follow',
                'unfollow' => '/api/v1/users/{id}/follow',
                'remove_follower' => '/api/v1/users/{id}/followers/{followerId}',
                'block' => '/api/v1/users/{id}/block',
                'unblock' => '/api/v1/users/{id}/block',
                'blocks' => '/api/v1/me/blocks',
                'suggested_follows' => '/api/v1/me/suggested-follows',
                'matchmaking_players' => '/api/v1/me/matchmaking/players',
            ],
            'messaging' => [
                'conversations' => '/api/v1/conversations?limit={limit}&cursor={cursor}',
                'start_conversation' => '/api/v1/conversations',
                'open_group_conversation' => '/api/v1/conversations/group',
                'thread' => '/api/v1/conversations/{id}',
                'participants' => '/api/v1/conversations/{id}/participants',
                'add_participant' => '/api/v1/conversations/{id}/participants',
                'remove_participant' => '/api/v1/conversations/{id}/participants/{userId}',
                'leave' => '/api/v1/conversations/{id}',
                'send_message' => '/api/v1/conversations/{id}/messages',
                'mark_read' => '/api/v1/conversations/{id}/read',
                'typing' => '/api/v1/conversations/{id}/typing',
                'upload_media' => '/api/v1/media',
                'legacy_upload_image' => '/api/v1/messages/upload-image',
            ],
            'notifications' => [
                'list' => '/api/v1/notifications?limit={limit}&cursor={cursor}',
                'read' => '/api/v1/notifications/{id}/read',
                'read_all' => '/api/v1/notifications/read-all',
                'delete' => '/api/v1/notifications/{id}',
                'delete_all' => '/api/v1/notifications',
            ],
            'catalog' => [
                'sports' => '/api/v1/sports',
                'venues' => '/api/v1/venues',
                'venue' => '/api/v1/venues/{id}',
                'courts' => '/api/v1/courts',
                'court' => '/api/v1/courts/{id}',
                'venue_availability' => '/api/v1/venues/{id}/availability?date={date}',
                'court_availability' => '/api/v1/courts/{id}/availability?date={date}',
                'suggested_slots' => '/api/v1/courts/{id}/suggested-slots?starts_at={iso}&duration_minutes={minutes}',
                'saved_venues' => '/api/v1/me/saved-venues',
                'save_venue' => '/api/v1/venues/{id}/save',
                'saved_courts' => '/api/v1/me/saved-courts',
                'save_court' => '/api/v1/courts/{id}/save',
                'venue_reviews' => '/api/v1/venues/{id}/reviews',
                'venue_rating_summary' => '/api/v1/venues/{id}/rating-summary',
            ],
            'bookings' => [
                'quote' => '/api/v1/bookings/quote',
                'create' => '/api/v1/bookings',
                'list' => '/api/v1/bookings',
                'mine' => '/api/v1/bookings/me',
                'show' => '/api/v1/bookings/{id}',
                'update' => '/api/v1/bookings/{id}',
                'cancel' => '/api/v1/bookings/{id}/cancel',
                'mark_paid' => '/api/v1/bookings/{id}/mark-paid',
                'receipt' => '/api/v1/bookings/{id}/receipt',
                'export' => '/api/v1/bookings/me/export',
                'holds' => '/api/v1/booking-holds',
                'release_hold' => '/api/v1/booking-holds/{id}',
                'waitlist' => '/api/v1/me/waitlist',
                'join_waitlist' => '/api/v1/courts/{id}/waitlist',
                'cancel_waitlist' => '/api/v1/waitlist/{id}',
                'promo_validate' => '/api/v1/promo-codes/validate',
            ],
            'games' => [
                'list' => '/api/v1/games',
                'show' => '/api/v1/games/{id}',
                'create' => '/api/v1/games',
                'update' => '/api/v1/games/{id}',
                'join' => '/api/v1/games/{id}/join',
                'leave' => '/api/v1/games/{id}/leave',
                'cancel' => '/api/v1/games/{id}/cancel',
                'invite' => '/api/v1/games/{id}/invite',
                'batch_invite' => '/api/v1/games/{id}/invitations',
                'medical_summary' => '/api/v1/games/{id}/medical-summary',
                'ratings' => '/api/v1/games/{id}/ratings',
                'result' => '/api/v1/games/{id}/result',
                'scoring' => '/api/v1/games/{id}/scoring',
                'scoring_start' => '/api/v1/games/{id}/scoring/start',
                'scoring_point' => '/api/v1/games/{id}/scoring/point',
                'scoring_undo' => '/api/v1/games/{id}/scoring/undo',
                'scoring_complete' => '/api/v1/games/{id}/scoring/complete',
                'series_create' => '/api/v1/game-series',
                'series_show' => '/api/v1/game-series/{id}',
                'series_cancel' => '/api/v1/game-series/{id}/cancel',
            ],
            'feed' => [
                'list' => '/api/v1/feed',
                'like' => '/api/v1/feed/{id}/like',
                'comments' => '/api/v1/feed/{eventId}/comments',
                'delete_comment' => '/api/v1/feed/comments/{commentId}',
            ],
            'stories' => [
                'create' => '/api/v1/stories',
                'upload_image' => '/api/v1/stories/upload-image',
                'feed' => '/api/v1/stories/feed',
                'view' => '/api/v1/stories/{id}/view',
                'viewers' => '/api/v1/stories/{id}/viewers',
                'reply' => '/api/v1/stories/{id}/reply',
                'delete' => '/api/v1/stories/{id}',
                'react' => '/api/v1/stories/{storyId}/react',
            ],
            'tournaments' => [
                'list' => '/api/v1/tournaments',
                'show' => '/api/v1/tournaments/{id}',
                'mine' => '/api/v1/me/tournaments',
                'enter' => '/api/v1/tournaments/{id}/entries',
                'withdraw_mine' => '/api/v1/tournaments/{id}/entries',
                'americano_create' => '/api/v1/americano/tournaments',
                'americano_list' => '/api/v1/americano/tournaments',
                'americano_mine' => '/api/v1/americano/tournaments/my',
                'americano_show' => '/api/v1/americano/tournaments/{id}',
                'americano_score' => '/api/v1/americano/matches/{id}/score',
            ],
            'learn' => [
                'lessons' => '/api/v1/lessons',
                'lesson' => '/api/v1/lessons/{id}',
                'coaches' => '/api/v1/coaches',
                'coach' => '/api/v1/coaches/{id}',
                'my_lessons' => '/api/v1/me/lessons',
                'book_lesson' => '/api/v1/lessons/{id}/book',
                'cancel_lesson' => '/api/v1/lessons/{id}/book',
            ],
            'support' => [
                'tickets' => '/api/v1/support/tickets',
                'ticket' => '/api/v1/support/tickets/{id}',
                'ticket_messages' => '/api/v1/support/tickets/{id}/messages',
                'close_ticket' => '/api/v1/support/tickets/{id}/close',
                'reports' => '/api/v1/reports',
                'my_reports' => '/api/v1/me/reports',
                'owner_applications' => '/api/v1/owner/applications',
                'launch_waitlist' => '/api/v1/launch-waitlist',
            ],
            'realtime' => [
                'health' => '/api/v1/realtime/health',
                'sse' => '/api/v1/realtime/sse',
            ],
        ];

        if ($subscriptionsEnabled) {
            $endpoints['membership'] = [
                'plans' => '/api/v1/membership/plans',
                'me' => '/api/v1/me/membership',
                'subscribe' => '/api/v1/membership/subscribe',
                'portal' => '/api/v1/me/membership/portal',
                'cancel' => '/api/v1/membership/cancel',
            ];
        }

        if ($paymentsEnabled) {
            $endpoints['payments'] = [
                'payment_history' => '/api/v1/payments/history',
                'payment_summary' => '/api/v1/payments/summary',
                'booking_intent' => '/api/v1/payments/booking/{id}/intent',
                'booking_status' => '/api/v1/payments/booking/{id}/status',
                'tournament_intent' => '/api/v1/payments/tournament/{tournamentId}/entry-intent',
            ];
        }

        return $endpoints;
    }

    private function mobileContracts(bool $paymentsEnabled): array
    {
        return [
            'auth' => [
                'bearer_header' => 'Authorization: Bearer {access_token}',
                'refresh_header_required' => false,
                'access_token_type' => 'jwt',
            ],
            'pagination' => [
                'cursor_fields' => ['limit', 'cursor'],
                'offset_fields' => ['limit', 'offset'],
                'default_limit' => 20,
                'max_limit' => 100,
            ],
            'media' => [
                'multipart_field' => 'file',
                'purpose_field' => 'purpose',
                'purposes' => ['message_image', 'message_voice', 'message_video', 'story_image', 'story_video', 'avatar', 'general'],
                'message_attachment_types' => ['image', 'voice', 'video'],
                'message_attachment_aliases' => ['audio' => 'voice'],
                'accepted_mime_types' => [
                    'image' => ['image/jpeg', 'image/png', 'image/webp'],
                    'voice' => ['audio/aac', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/m4a', 'audio/caf', 'audio/x-caf', 'audio/amr', 'audio/3gpp', 'application/ogg'],
                    'video' => ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'],
                ],
                'max_bytes' => [
                    'image' => 8 * 1024 * 1024,
                    'voice' => 25 * 1024 * 1024,
                    'video' => 50 * 1024 * 1024,
                ],
            ],
            'messaging' => [
                'send_body_required_when_no_attachment' => true,
                'empty_body_allowed_with_attachment' => true,
                'voice_messages_use_attachment_type' => 'voice',
                'audio_attachment_type_is_accepted_as_alias' => true,
                'thread_limit' => 500,
                'typing_timeout_ms' => 2500,
            ],
            'realtime' => [
                'transport' => 'polling',
                'sse_available' => true,
                'poll_endpoints' => ['messaging.conversations', 'messaging.thread', 'me.unread_counts', 'notifications.list'],
            ],
            'payments' => [
                'enabled' => $paymentsEnabled,
                'bank_transfer_enabled' => false,
            ],
        ];
    }

    private function configAccessPayload(MembershipService $membership, bool $subscriptionsEnabled): array
    {
        if ($subscriptionsEnabled) {
            return [
                'mode' => 'standard',
                'full_access' => false,
                'on_trial' => false,
                'trial_ends_at' => null,
                'global_full_access' => false,
                'features' => $membership->publicFeaturesForTier('free'),
            ];
        }

        return [
            'mode' => 'free_launch',
            'full_access' => true,
            'on_trial' => true,
            'trial_ends_at' => config('membership.global_full_access_until') ?: null,
            'global_full_access' => config('membership.global_full_access_until') !== null,
            'features' => $membership->publicFeaturesForTier('premium'),
            'feature_matrix' => $membership->featureMatrix(),
        ];
    }

    private function accessPayload(string $userId, MembershipService $membership): array
    {
        $state = $membership->resolve($userId);

        return [
            'mode' => $membership->publicSubscriptionsEnabled() ? 'standard' : 'free_launch',
            'full_access' => $state->is_premium,
            'on_trial' => $state->on_trial,
            'trial_ends_at' => $state->trial_ends_at,
            'global_full_access' => $state->global_full_access,
            'features' => $membership->publicFeaturesForUser($userId),
            'feature_matrix' => $membership->featureMatrix(),
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
