<?php

return [
    // Every new user gets full premium access for this many days from
    // registration (the 1-month free trial). Set to 0 to disable trials.
    //
    // IMPORTANT: read via config() — NOT env() at runtime. Once
    // `php artisan config:cache` runs in production, env() returns null
    // outside config files, which would silently disable the trial and
    // zero-out the free limits (locking every user out of hosting/booking).
    'free_trial_days' => (int) env('FREE_TRIAL_DAYS', 30),

    // Generous monthly caps for the free tier. Premium / trial = unlimited.
    'free_games_per_month' => (int) env('FREE_GAMES_PER_MONTH', 30),
    'free_bookings_per_month' => (int) env('FREE_BOOKINGS_PER_MONTH', 30),
];
