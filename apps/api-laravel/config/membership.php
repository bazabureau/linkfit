<?php

return [
    // Every new user gets full premium access for this many days from
    // registration. Set to 0 to disable per-user trials.
    //
    // IMPORTANT: read via config() — NOT env() at runtime. Once
    // `php artisan config:cache` runs in production, env() returns null
    // outside config files, which would silently disable the trial and
    // zero-out the free limits (locking every user out of hosting/booking).
    'free_trial_days' => (int) env('FREE_TRIAL_DAYS', 50),

    // Launch/promo full-access window for EVERY user, including existing
    // accounts. Use an ISO timestamp, for example 2026-08-09T00:00:00Z.
    'global_full_access_until' => env('GLOBAL_FULL_ACCESS_UNTIL'),

    // Generous monthly caps for the free tier. Premium / trial = unlimited.
    'free_games_per_month' => (int) env('FREE_GAMES_PER_MONTH', 30),
    'free_bookings_per_month' => (int) env('FREE_BOOKINGS_PER_MONTH', 30),

    'currency' => env('MEMBERSHIP_CURRENCY', 'AZN'),
    'premium_price_minor' => (int) env('PREMIUM_PRICE_MINOR', 0),

    // Payment provider will be connected after the Azerbaijani provider is
    // chosen. Until then, user-facing subscribe must not grant paid access.
    'payments_enabled' => (bool) env('MEMBERSHIP_PAYMENTS_ENABLED', false),
    'payment_provider' => env('MEMBERSHIP_PAYMENT_PROVIDER'),

    'plans' => [
        'free' => [
            'name' => 'Free',
            'features' => [
                'profile',
                'player_search',
                'join_public_games',
                'host_limited_games',
                'book_limited_courts',
                'basic_rankings',
                'basic_insights',
                'messages',
                'medical_profile',
            ],
        ],
        'premium' => [
            'name' => 'Premium',
            'features' => [
                'profile',
                'player_search',
                'join_public_games',
                'host_unlimited_games',
                'book_unlimited_courts',
                'advanced_rankings',
                'advanced_insights',
                'priority_matchmaking',
                'early_tournament_access',
                'premium_badge',
                'messages',
                'medical_profile',
            ],
        ],
    ],
];
