<?php

$configuredOrigins = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('CORS_ALLOWED_ORIGINS', '')),
)));

return [
    'paths' => ['api/*', 'health', 'health/*', 'realtime/*', 'broadcasting/auth', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $configuredOrigins !== [] ? $configuredOrigins : [
        'http://142.93.100.82',
        'https://142.93.100.82',
        'http://localhost:3000',
        'http://localhost:3100',
        'http://localhost:4000',
        'https://linkfit.az',
        'https://www.linkfit.az',
        'https://admin.linkfit.az',
        'https://owner.linkfit.az',
    ],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => ['X-Request-Id'],
    'max_age' => 86400,
    'supports_credentials' => false,
];
