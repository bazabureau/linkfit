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
            'configured' => $this->apnsConfigured(),
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
            ->where('platform', 'ios')
            ->whereNull('revoked_at')
            ->exists() ? 'sent' : 'skipped';
    }

    private function sendJob(object $job): string
    {
        if (! $this->apnsConfigured()) {
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

        $tokens = DB::table('device_tokens')
            ->where('user_id', $job->user_id)
            ->where('platform', 'ios')
            ->whereNull('revoked_at')
            ->pluck('token')
            ->filter()
            ->values();

        if ($tokens->isEmpty()) {
            $this->finishJob($job->id, 'skipped', 'No active iOS device tokens');

            return 'skipped';
        }

        try {
            $client = new Client($this->authProvider(), (bool) config('services.apns.production'));
            $payload = $this->payloadForJob($job);
            $notifications = $tokens
                ->map(fn ($token) => (new Notification($payload, (string) $token))->setHighPriority())
                ->all();

            $client->addNotifications($notifications);
            $responses = $client->push();
        } catch (Throwable $e) {
            $this->retryJob($job, $e->getMessage());

            return 'retry';
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
                DB::table('device_tokens')->where('token', $token)->update(['revoked_at' => now()]);
            }
        }

        if ($sent > 0) {
            $this->finishJob($job->id, 'sent', null, ['sent' => $sent, 'failed' => $failed]);

            return 'sent';
        }

        $error = $failed === [] ? 'APNs returned no successful responses' : json_encode($failed);
        $this->retryJob($job, (string) $error, ['failed' => $failed]);

        return 'retry';
    }

    private function payloadForJob(object $job): Payload
    {
        $payload = Payload::create()
            ->setPushType('alert')
            ->setAlert(Alert::create()->setTitle((string) $job->title)->setBody((string) $job->body))
            ->setSound('default')
            ->setCustomValue('job_id', (string) $job->id)
            ->setCustomValue('notification_type', (string) $job->type);

        $custom = json_decode((string) ($job->payload ?? '{}'), true);
        if (is_array($custom)) {
            foreach ($custom as $key => $value) {
                if ($key !== 'aps') {
                    $payload->setCustomValue((string) $key, $value);
                }
            }
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
