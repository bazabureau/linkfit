<?php

namespace App\Services\Notifications;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Pushok\AuthProvider\Token;
use Pushok\Client;
use Pushok\Notification;
use Pushok\Payload;
use Pushok\Payload\Alert;
use Throwable;

class PushDispatcher
{
    public function __construct(private FcmSender $fcm)
    {
    }

    public function process(int $limit = 100, bool $dryRun = false): array
    {
        $limit = min(max($limit, 1), 500);
        $stats = [
            'claimed' => 0,
            'sent' => 0,
            'retry' => 0,
            'failed' => 0,
            'skipped' => 0,
            'deferred' => 0,
            'dry_run' => $dryRun,
            'configured' => $this->apnsConfigured() || $this->fcm->isConfigured(),
        ];

        if (! $dryRun && ! $stats['configured']) {
            return $stats;
        }

        $jobs = $this->claimJobs($limit, $dryRun);
        $stats['claimed'] = $jobs->count();

        foreach ($jobs as $job) {
            $result = $dryRun ? $this->dryRunJob($job) : $this->sendJob($job);
            $stats[$result] = ($stats[$result] ?? 0) + 1;
        }

        return $stats;
    }

    private function claimJobs(int $limit, bool $dryRun): Collection
    {
        if ($dryRun) {
            return DB::table('push_notification_jobs')
                ->where('status', 'pending')
                ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->orderBy('created_at')
                ->limit($limit)
                ->get();
        }

        return DB::transaction(function () use ($limit) {
            $jobs = DB::table('push_notification_jobs')
                ->whereIn('status', ['pending', 'retry'])
                ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->where('attempts', '<', 5)
                ->orderBy('created_at')
                ->limit($limit)
                ->lockForUpdate()
                ->get();

            if ($jobs->isNotEmpty()) {
                DB::table('push_notification_jobs')
                    ->whereIn('id', $jobs->pluck('id')->all())
                    ->update([
                        'status' => 'processing',
                        'attempts' => DB::raw('attempts + 1'),
                        'last_attempt_at' => now(),
                        'updated_at' => now(),
                    ]);
            }

            return $jobs;
        });
    }

    private function dryRunJob(object $job): string
    {
        return DB::table('device_tokens')
            ->where('user_id', $job->user_id)
            ->whereIn('platform', ['ios', 'android'])
            ->whereNull('revoked_at')
            ->exists() ? 'sent' : 'skipped';
    }

    private function sendJob(object $job): string
    {
        $apnsReady = $this->apnsConfigured();
        $fcmReady = $this->fcm->isConfigured();
        if (! $apnsReady && ! $fcmReady) {
            return 'skipped';
        }

        $policy = $this->pushPolicy($job);
        if (! $policy['enabled']) {
            $this->finishJob($job->id, 'skipped', 'Push disabled by user preference');

            return 'skipped';
        }
        if ($policy['defer_until'] !== null) {
            $this->deferJob($job->id, $policy['defer_until']);

            return 'deferred';
        }

        // Only fan out to platforms we can actually deliver to. A token whose
        // platform has no configured provider is left untouched (not skipped as
        // dead) so it can deliver once that provider is wired.
        $platforms = array_merge($apnsReady ? ['ios'] : [], $fcmReady ? ['android'] : []);
        $tokens = DB::table('device_tokens')
            ->where('user_id', $job->user_id)
            ->whereIn('platform', $platforms)
            ->whereNull('revoked_at')
            ->get(['token', 'platform']);

        if ($tokens->isEmpty()) {
            $this->finishJob($job->id, 'skipped', 'No active deliverable device tokens');

            return 'skipped';
        }

        $sent = 0;
        $failed = [];
        $hadTransportError = false;

        $iosTokens = $tokens->where('platform', 'ios')->pluck('token')->filter()->values();
        if ($apnsReady && $iosTokens->isNotEmpty()) {
            $apnsResult = $this->sendApns($job, $iosTokens);
            $sent += $apnsResult['sent'];
            $failed = array_merge($failed, $apnsResult['failed']);
            $hadTransportError = $hadTransportError || $apnsResult['transport_error'];
        }

        $androidTokens = $tokens->where('platform', 'android')->pluck('token')->filter()->values()->all();
        if ($fcmReady && $androidTokens !== []) {
            $fcmResult = $this->fcm->send($androidTokens, (string) $job->title, (string) $job->body, $this->customData($job));
            $sent += $fcmResult['sent'];
            foreach ($fcmResult['dead_tokens'] as $deadToken) {
                $this->revokeToken((string) $deadToken, $job->user_id);
                $failed[] = ['token_suffix' => substr((string) $deadToken, -8), 'status' => 'fcm', 'reason' => 'unregistered'];
            }
            if ($fcmResult['error'] !== null) {
                $hadTransportError = true;
                $failed[] = ['platform' => 'android', 'status' => 'fcm', 'reason' => $fcmResult['error']];
            }
        }

        if ($sent > 0) {
            $this->finishJob($job->id, 'sent', null, ['sent' => $sent, 'failed' => $failed]);

            return 'sent';
        }

        // No delivery. Retry only if something transient happened; otherwise the
        // tokens were dead and there is nothing left to deliver to.
        if (! $hadTransportError && $failed !== []) {
            $this->finishJob($job->id, 'skipped', json_encode($failed), ['failed' => $failed]);

            return 'skipped';
        }

        $error = $failed === [] ? 'No push provider returned a successful response' : json_encode($failed);
        $this->retryJob($job, (string) $error, ['failed' => $failed]);

        return 'retry';
    }

    /**
     * Deliver to iOS tokens via APNs.
     *
     * @param  \Illuminate\Support\Collection<int, mixed>  $tokens
     * @return array{sent:int, failed:list<array<string, mixed>>, transport_error:bool}
     */
    private function sendApns(object $job, Collection $tokens): array
    {
        try {
            $client = new Client($this->authProvider(), (bool) config('services.apns.production'));
            $payload = $this->payloadForJob($job);
            $notifications = $tokens
                ->map(fn ($token) => (new Notification($payload, (string) $token))->setHighPriority())
                ->all();

            $client->addNotifications($notifications);
            $responses = $client->push();
        } catch (Throwable $e) {
            return ['sent' => 0, 'failed' => [['platform' => 'ios', 'reason' => $e->getMessage()]], 'transport_error' => true];
        }

        $sent = 0;
        $failed = [];
        foreach ($responses as $response) {
            $status = $response->getStatusCode();
            if ($status === 200) {
                $sent++;
                continue;
            }

            $token = (string) $response->getDeviceToken();
            $reason = trim($response->getErrorReason().' '.$response->getErrorDescription());
            $failed[] = [
                'token_suffix' => substr($token, -8),
                'status' => $status,
                'reason' => $reason,
            ];

            if ($status === 410 || in_array($response->getErrorReason(), ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'], true)) {
                $this->revokeToken($token, $job->user_id);
            }
        }

        return ['sent' => $sent, 'failed' => $failed, 'transport_error' => false];
    }

    /**
     * Revoke a dead token, scoped to this job's user — the same physical token
     * can exist for multiple users; never revoke another user's valid token.
     */
    private function revokeToken(string $token, mixed $userId): void
    {
        DB::table('device_tokens')->where('token', $token)->where('user_id', $userId)->update(['revoked_at' => now()]);
    }

    /**
     * Flat custom-data map shared by both providers (job + payload extras).
     *
     * @return array<string, mixed>
     */
    private function customData(object $job): array
    {
        $data = [
            'job_id' => (string) $job->id,
            'notification_type' => (string) $job->type,
        ];
        $custom = json_decode((string) ($job->payload ?? '{}'), true);
        if (is_array($custom)) {
            foreach ($custom as $key => $value) {
                if ($key !== 'aps') {
                    $data[(string) $key] = $value;
                }
            }
        }

        return $data;
    }

    private function payloadForJob(object $job): Payload
    {
        $payload = Payload::create()
            ->setPushType('alert')
            ->setAlert(Alert::create()->setTitle((string) $job->title)->setBody((string) $job->body))
            ->setSound('default');

        foreach ($this->customData($job) as $key => $value) {
            $payload->setCustomValue((string) $key, $value);
        }

        return $payload;
    }

    private function authProvider(): Token
    {
        return Token::create([
            'key_id' => (string) config('services.apns.key_id'),
            'team_id' => (string) config('services.apns.team_id'),
            'app_bundle_id' => (string) config('services.apns.bundle_id'),
            'private_key_path' => (string) config('services.apns.private_key_path'),
        ]);
    }

    private function apnsConfigured(): bool
    {
        $path = (string) config('services.apns.private_key_path');

        return config('services.apns.key_id') !== null
            && config('services.apns.team_id') !== null
            && config('services.apns.bundle_id') !== null
            && $path !== ''
            && is_readable($path);
    }

    private function pushPolicy(object $job): array
    {
        $row = DB::table('users as u')
            ->leftJoin('notification_preferences as np', function ($join) use ($job) {
                $join->on('np.user_id', '=', 'u.id')->whereRaw('np.type::text = ?', [$job->type]);
            })
            ->where('u.id', $job->user_id)
            ->first([
                'u.quiet_hours_start',
                'u.quiet_hours_end',
                'np.push_enabled',
            ]);

        if ($row === null) {
            return ['enabled' => false, 'defer_until' => null];
        }
        if ($row->push_enabled !== null && ! (bool) $row->push_enabled) {
            return ['enabled' => false, 'defer_until' => null];
        }

        $start = $row->quiet_hours_start;
        $end = $row->quiet_hours_end;
        if ($start === null || $end === null || (int) $start === (int) $end) {
            return ['enabled' => true, 'defer_until' => null];
        }

        $hour = (int) now('UTC')->format('G');
        $start = (int) $start;
        $end = (int) $end;
        $inside = $start < $end
            ? ($hour >= $start && $hour < $end)
            : ($hour >= $start || $hour < $end);

        if (! $inside) {
            return ['enabled' => true, 'defer_until' => null];
        }

        $deferUntil = now('UTC')->setTime($end, 0);
        if ($deferUntil <= now('UTC')) {
            $deferUntil = $deferUntil->addDay();
        }

        return ['enabled' => true, 'defer_until' => $deferUntil];
    }

    private function deferJob(string $id, mixed $availableAt): void
    {
        DB::table('push_notification_jobs')->where('id', $id)->update([
            'status' => 'pending',
            'available_at' => $availableAt,
            'attempts' => DB::raw('GREATEST(attempts - 1, 0)'),
            'last_attempt_at' => null,
            'updated_at' => now(),
        ]);
    }

    private function finishJob(string $id, string $status, ?string $error = null, ?array $providerResponse = null): void
    {
        DB::table('push_notification_jobs')->where('id', $id)->update([
            'status' => $status,
            'sent_at' => $status === 'sent' ? now() : null,
            'error' => $error,
            'provider_response' => $providerResponse !== null ? json_encode($providerResponse) : null,
            'updated_at' => now(),
        ]);
    }

    private function retryJob(object $job, string $error, ?array $providerResponse = null): void
    {
        $attempts = (int) ($job->attempts ?? 0) + 1;
        DB::table('push_notification_jobs')->where('id', $job->id)->update([
            'status' => $attempts >= 5 ? 'failed' : 'retry',
            'available_at' => now()->addMinutes(min(60, 2 ** $attempts)),
            'error' => $error,
            'provider_response' => $providerResponse !== null ? json_encode($providerResponse) : null,
            'updated_at' => now(),
        ]);
    }
}
