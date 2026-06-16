<?php

namespace App\Services\Auth;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class EmailTokenService
{
    public function create(string $userId, string $kind, int $ttlMinutes = 60): string
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        DB::statement(
            'INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, decode(?, \'hex\'), ?, now())',
            [(string) Str::uuid(), $userId, $kind, hash('sha256', $token), now()->addMinutes($ttlMinutes)],
        );

        return $token;
    }

    public function consume(string $token, string $kind): object
    {
        $row = DB::table('email_tokens')
            ->where('kind', $kind)
            ->whereRaw('token_hash = decode(?, \'hex\')', [hash('sha256', $token)])
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->first();
        if ($row === null) {
            throw ApiException::unauthenticated('Invalid or expired token');
        }
        DB::table('email_tokens')->where('id', $row->id)->update(['used_at' => now()]);

        return $row;
    }
}
