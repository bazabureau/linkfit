<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Auth\TokenService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
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

        return response()->json(['accepted' => count($data['events'])], 202);
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
