<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends ApiController
{
    public function health(): JsonResponse
    {
        return response()->json(['ok' => true]);
    }

    public function ready(): JsonResponse
    {
        DB::select('select 1');

        return response()->json(['ok' => true, 'checks' => ['db' => 'ok']]);
    }
}
