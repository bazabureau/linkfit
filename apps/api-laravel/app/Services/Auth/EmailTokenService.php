<?php

namespace App\Services\Auth;

use App\Support\ApiException;
use Illuminate\Support\Facades\Config;
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

    public function createCode(string $userId, string $kind, int $ttlMinutes = 10): string
    {
        $this->invalidatePendingForUser($userId, $kind);

        for ($attempt = 0; $attempt < 5; $attempt += 1) {
            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            try {
                DB::statement(
                    'INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, decode(?, \'hex\'), ?, now())',
                    [(string) Str::uuid(), $userId, $kind, $this->scopedCodeHash($userId, $kind, $code), now()->addMinutes($ttlMinutes)],
                );

                return $code;
            } catch (\Throwable) {
                // token_hash is globally unique. A repeated six-digit code for
                // the same user is rare but possible over time, so retry.
            }
        }

        throw ApiException::validation('Could not create reset code');
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

    public function consumeCodeForUser(string $userId, string $kind, string $code): object
    {
        $row = DB::table('email_tokens')
            ->where('user_id', $userId)
            ->where('kind', $kind)
            ->whereRaw('token_hash = decode(?, \'hex\')', [$this->scopedCodeHash($userId, $kind, $code)])
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->first();
        if ($row === null) {
            throw ApiException::unauthenticated('Invalid or expired code');
        }
        DB::table('email_tokens')->where('id', $row->id)->update(['used_at' => now()]);

        return $row;
    }

    public function invalidatePendingForUser(string $userId, string $kind): void
    {
        DB::table('email_tokens')
            ->where('user_id', $userId)
            ->where('kind', $kind)
            ->whereNull('used_at')
            ->update(['used_at' => now()]);
    }

    private function scopedCodeHash(string $userId, string $kind, string $code): string
    {
        return hash_hmac('sha256', $userId.':'.$kind.':'.$code, $this->tokenHashSecret());
    }

    private function tokenHashSecret(): string
    {
        $key = (string) Config::get('app.key', '');

        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if ($decoded !== false && $decoded !== '') {
                return $decoded;
            }
        }

        return $key;
    }
}
