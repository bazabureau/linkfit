<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LaunchWaitlistController extends ApiController
{
    public function store(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'email' => ['required', 'email:rfc', 'max:190'],
            'phone' => ['nullable', 'string', 'max:40'],
            'role' => ['nullable', 'string', 'in:player,venue,coach,other'],
            'locale' => ['nullable', 'string', 'in:az,en,ru'],
            'source' => ['nullable', 'string', 'max:80'],
            'message' => ['nullable', 'string', 'max:1200'],
        ]);

        $email = mb_strtolower(trim((string) $data['email']));
        $now = now();
        $existing = DB::table('launch_waitlist_entries')->where('email', $email)->first(['id']);
        $id = $existing->id ?? (string) Str::uuid();

        $payload = [
            'name' => trim((string) $data['name']),
            'email' => $email,
            'phone' => isset($data['phone']) && trim((string) $data['phone']) !== '' ? trim((string) $data['phone']) : null,
            'role' => $data['role'] ?? 'player',
            'locale' => $data['locale'] ?? 'az',
            'source' => $data['source'] ?? 'web_waitlist',
            'message' => isset($data['message']) && trim((string) $data['message']) !== '' ? trim((string) $data['message']) : null,
            'ip_address' => $request->ip(),
            'user_agent' => substr((string) $request->userAgent(), 0, 512),
            'updated_at' => $now,
        ];

        if ($existing === null) {
            DB::table('launch_waitlist_entries')->insert(array_merge($payload, [
                'id' => $id,
                'created_at' => $now,
            ]));
        } else {
            DB::table('launch_waitlist_entries')->where('id', $id)->update($payload);
        }

        return response()->json(['ok' => true, 'id' => $id], $existing === null ? 201 : 200);
    }
}
