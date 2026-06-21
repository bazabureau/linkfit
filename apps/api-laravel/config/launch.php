<?php

return [
    'start_at' => env('LAUNCH_START_AT', '2026-06-21T00:00:00Z'),
    'end_at' => env('LAUNCH_END_AT', env('GLOBAL_FULL_ACCESS_UNTIL')),
    'window_days' => (int) env('LAUNCH_WINDOW_DAYS', 50),

    'monetization_enabled' => (bool) env('MONETIZATION_ENABLED', false),
    'premium_unlocked_for_all' => (bool) env('PREMIUM_UNLOCKED_FOR_ALL', true),
    'booking_fee_enabled' => (bool) env('BOOKING_FEE_ENABLED', false),
    'booking_service_fee_minor' => (int) env('BOOKING_SERVICE_FEE_MINOR', 0),
    'online_payment_enabled' => (bool) env('ONLINE_PAYMENT_ENABLED', false),
    'referral_enabled' => (bool) env('REFERRAL_ENABLED', true),
    'promo_enabled' => (bool) env('PROMO_ENABLED', true),
    'free_cancellation_enabled' => (bool) env('LAUNCH_FREE_CANCELLATION_ENABLED', true),

    'targets' => [
        'active_players' => (int) env('LAUNCH_TARGET_ACTIVE_PLAYERS', 500),
        'bookings' => (int) env('LAUNCH_TARGET_BOOKINGS', 300),
        'court_fill_rate_pct' => (int) env('LAUNCH_TARGET_COURT_FILL_RATE_PCT', 35),
    ],
];
