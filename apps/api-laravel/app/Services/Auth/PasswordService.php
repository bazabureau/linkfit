<?php

namespace App\Services\Auth;

/**
 * argon2id password hashing, wire-compatible with the existing
 * `users.password_hash` column.
 * PHP's password_verify reads those PHC strings natively; new hashes use the
 * same params so the column stays homogeneous.
 */
class PasswordService
{
    public function hash(string $plain): string
    {
        $cfg = config('auth_tokens.argon');

        return password_hash($plain, PASSWORD_ARGON2ID, [
            'memory_cost' => $cfg['memory_cost'],
            'time_cost' => $cfg['time_cost'],
            'threads' => $cfg['threads'],
        ]);
    }

    public function verify(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }
}
