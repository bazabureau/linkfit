<?php

return [
    // Keep this HS256 secret stable so access tokens remain valid across
    // backend deployments. Set JWT_ACCESS_SECRET in .env.
    'access_secret' => env('JWT_ACCESS_SECRET', ''),
    'access_ttl_seconds' => (int) env('JWT_ACCESS_TTL_SECONDS', 900),
    'refresh_ttl_days' => (int) env('JWT_REFRESH_TTL_DAYS', 30),

    // argon2id params — MUST match the existing hashes so old users verify
    // and new hashes are consistent (memory_cost in KiB).
    'argon' => [
        'memory_cost' => 65536,
        'time_cost' => 3,
        'threads' => 4,
    ],
];
