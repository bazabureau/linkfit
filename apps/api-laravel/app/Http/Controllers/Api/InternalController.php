<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InternalController extends ApiController
{
    public function capabilities(Request $request): JsonResponse
    {
        return response()->json([
            'ok' => true,
            'mode' => 'internal',
            'api_key_type' => $request->attributes->get('linkfit_api_key_type'),
            'features' => [
                'server_to_server' => true,
                'public_subscriptions' => (bool) config('membership.public_subscriptions_enabled'),
                'payments' => (bool) config('membership.payments_enabled'),
                'free_launch_access' => ! (bool) config('membership.public_subscriptions_enabled'),
            ],
            'launch_free_access_until' => config('membership.global_full_access_until') ?: null,
        ]);
    }
}
