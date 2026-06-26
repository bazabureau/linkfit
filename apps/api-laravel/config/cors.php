<?php

$configuredOrigins = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('CORS_ALLOWED_ORIGINS', '')),
)));

$isProduction = strtolower((string) env('APP_ENV', 'production')) === 'production';

$productionOrigins = [
    'https://linkfit.az',
    'https://www.linkfit.az',
    'https://admin.linkfit.az',
    'https://owner.linkfit.az',
];

$localOrigins = [
    'http://localhost:3000',
    'http://localhost:3100',
    'http://localhost:4000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3100',
    'http://127.0.0.1:4000',
];

return [
    'paths' => ['api/*', 'health', 'health/*', 'realtime/*', 'broadcasting/auth', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $configuredOrigins !== []
        ? $configuredOrigins
        : ($isProduction ? $productionOrigins : [...$localOrigins, ...$productionOrigins]),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => ['X-Request-Id'],
    'max_age' => 86400,
    // Web clients send credentials:"include" so the httpOnly lf_access/lf_refresh
    // cookies travel with every cross-subdomain API call. Origins above are the
    // explicit 4 Linkfit subdomains (never "*"), so crediting them is safe.
    'supports_credentials' => true,
];
