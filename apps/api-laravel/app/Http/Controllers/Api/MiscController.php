<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Auth\TokenService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class MiscController extends ApiController
{
    public function realtimeHealth(): JsonResponse
    {
        return response()->json(['ok' => true, 'transport' => 'polling']);
    }

    public function analytics(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'events' => ['required', 'array', 'max:100'],
            'events.*.event' => ['required', 'string', 'max:160'],
            'events.*.properties' => ['sometimes', 'array'],
            'events.*.distinct_id' => ['sometimes', 'nullable', 'string', 'max:120'],
            'events.*.ts' => ['sometimes', 'nullable'],
        ]);

        Log::info('analytics.events', ['count' => count($data['events'])]);
        if (Schema::hasTable('launch_analytics_events')) {
            $rows = [];
            foreach ($data['events'] as $event) {
                // `source` is derived from caller-supplied properties (never directly
                // validated) and lands in a varchar(40) column. Cap it and reject
                // non-scalar values so a long/array source can't 500 this public,
                // unauthenticated ingestion endpoint (Postgres 22001 / array-to-string).
                $source = $event['properties']['source'] ?? 'web';
                $source = is_scalar($source) ? mb_substr((string) $source, 0, 40) : 'web';

                $rows[] = [
                    'id' => (string) Str::uuid(),
                    'event' => (string) $event['event'],
                    'distinct_id' => $event['distinct_id'] ?? null,
                    'user_id' => null,
                    'properties' => json_encode($event['properties'] ?? []),
                    'source' => $source,
                    'ip_hash' => $request->ip() ? hash('sha256', $request->ip().(string) config('app.key')) : null,
                    'occurred_at' => $this->parseAnalyticsTime($event['ts'] ?? null),
                    'created_at' => now(),
                ];
            }
            DB::table('launch_analytics_events')->insert($rows);
        }

        return response()->json(['accepted' => count($data['events'])], 202);
    }

    private function parseAnalyticsTime(mixed $value): \DateTimeInterface
    {
        if ($value === null || $value === '') {
            return now();
        }

        try {
            return is_numeric($value) ? now()->setTimestamp((int) $value) : new \DateTimeImmutable((string) $value);
        } catch (Throwable) {
            return now();
        }
    }

    public function realtimeSse(Request $request, TokenService $tokens): StreamedResponse|JsonResponse
    {
        $token = (string) $request->query('token', '');
        try {
            $claims = $tokens->verifyAccess($token);
            $user = User::whereNull('deleted_at')->find($claims->sub ?? null);
        } catch (Throwable) {
            throw ApiException::unauthenticated('Invalid or expired token');
        }
        if ($user === null) {
            throw ApiException::unauthenticated('Account not found');
        }

        return response()->stream(function () use ($user) {
            echo "event: ready\n";
            echo 'data: '.json_encode(['user_id' => $user->id, 'transport' => 'sse'])."\n\n";
            @ob_flush();
            flush();

            echo ": heartbeat\n\n";
            @ob_flush();
            flush();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
