<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

trait HandlesIdempotentRequests
{
    protected function resolveRequestIdempotencyKey(Request $request, ?string $bodyKey = null, bool $generateIfMissing = false): ?string
    {
        $key = trim((string) ($bodyKey ?: $request->header('Idempotency-Key', '')));
        if (strlen($key) >= 8) {
            return mb_substr($key, 0, 200);
        }
        if ($generateIfMissing) {
            return (string) Str::uuid();
        }

        return null;
    }

    protected function requireRequestIdempotencyKey(Request $request, ?string $bodyKey = null): string
    {
        $key = $this->resolveRequestIdempotencyKey($request, $bodyKey, false);
        if ($key === null) {
            throw ApiException::validation('idempotency_key is required (request body or Idempotency-Key header)');
        }

        return $key;
    }

    protected function replayOrStoreIdempotentResponse(Request $request, ?string $key, Closure $callback): JsonResponse
    {
        if ($key === null || ! Schema::hasTable('api_idempotency_keys')) {
            return $callback();
        }

        $userId = (string) ($this->authUser($request)->id ?? '');
        $routeKey = $this->idempotencyRouteKey($request);
        $requestHash = $this->idempotencyRequestHash($request);

        $existingResponse = null;
        DB::transaction(function () use ($userId, $routeKey, $key, $requestHash, &$existingResponse): void {
            $existing = DB::table('api_idempotency_keys')
                ->where('user_id', $userId)
                ->where('route_key', $routeKey)
                ->where('idempotency_key', $key)
                ->lockForUpdate()
                ->first();

            if ($existing === null) {
                DB::table('api_idempotency_keys')->insert([
                    'id' => (string) Str::uuid(),
                    'user_id' => $userId,
                    'route_key' => $routeKey,
                    'idempotency_key' => $key,
                    'request_hash' => $requestHash,
                    'status' => 'processing',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return;
            }

            if (! hash_equals((string) $existing->request_hash, $requestHash)) {
                throw ApiException::conflict('Idempotency key was reused with a different request');
            }

            if ($existing->status === 'completed') {
                $existingResponse = response()->json(
                    json_decode((string) $existing->response_body, true) ?? [],
                    (int) $existing->response_status
                );

                return;
            }

            throw ApiException::conflict('Idempotent request is already in progress');
        });

        if ($existingResponse instanceof JsonResponse) {
            return $existingResponse;
        }

        try {
            $response = $callback();
        } catch (\Throwable $e) {
            DB::table('api_idempotency_keys')
                ->where('user_id', $userId)
                ->where('route_key', $routeKey)
                ->where('idempotency_key', $key)
                ->where('status', 'processing')
                ->delete();
            throw $e;
        }

        DB::table('api_idempotency_keys')
            ->where('user_id', $userId)
            ->where('route_key', $routeKey)
            ->where('idempotency_key', $key)
            ->update([
                'status' => 'completed',
                'response_status' => $response->getStatusCode(),
                'response_body' => (string) $response->getContent(),
                'completed_at' => now(),
                'updated_at' => now(),
            ]);

        return $response;
    }

    private function idempotencyRouteKey(Request $request): string
    {
        $route = $request->route();
        $uri = $route?->uri() ?: ltrim($request->path(), '/');

        return strtoupper($request->method()).' '.$uri;
    }

    private function idempotencyRequestHash(Request $request): string
    {
        $payload = $request->all();
        unset($payload['idempotency_key']);
        ksort($payload);

        return hash('sha256', strtoupper($request->method()).'|'.$request->path().'|'.json_encode($payload));
    }
}
