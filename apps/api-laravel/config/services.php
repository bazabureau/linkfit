<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google' => [
        // Default to the app's OAuth client ids (server + iOS) so Google sign-in
        // works out of the box. With google_sign_in's serverClientId set, the ID
        // token's aud is the SERVER client id — accept both. These are public
        // OAuth client ids (not secrets); override via GOOGLE_CLIENT_IDS.
        'client_id' => env('GOOGLE_CLIENT_ID', '655337821050-mn0csu1bml6bbps9egumdsgr2akddnlp.apps.googleusercontent.com'),
        'client_ids' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env(
                'GOOGLE_CLIENT_IDS',
                env('GOOGLE_CLIENT_ID', '655337821050-mn0csu1bml6bbps9egumdsgr2akddnlp.apps.googleusercontent.com,655337821050-pi74ppu4gjv7b0gs0v417djtndrl7nt2.apps.googleusercontent.com')
            ))
        ))),
    ],

    'gmail' => [
        'client_id' => env('GMAIL_CLIENT_ID'),
        'client_secret' => env('GMAIL_CLIENT_SECRET'),
        'refresh_token' => env('GMAIL_REFRESH_TOKEN'),
    ],

    'apple' => [
        // Native iOS "Sign in with Apple" identity tokens carry aud = the app
        // bundle id. The bundle id is public (not a secret), so default to it —
        // Apple sign-in then works out of the box, no prod env change required.
        // Override or extend (e.g. add a web Service ID) via APPLE_CLIENT_ID, or
        // a comma-separated APPLE_CLIENT_IDS.
        'client_id' => env('APPLE_CLIENT_ID', 'az.linkfit.app'),
        'client_ids' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('APPLE_CLIENT_IDS', env('APPLE_CLIENT_ID', 'az.linkfit.app')))
        ))),
    ],

    'apns' => [
        'key_id' => env('APNS_KEY_ID'),
        'team_id' => env('APNS_TEAM_ID'),
        'bundle_id' => env('APNS_BUNDLE_ID'),
        'private_key_path' => env('APNS_PRIVATE_KEY_PATH'),
        'production' => env('APNS_PRODUCTION', false),
    ],

    // Firebase Cloud Messaging (HTTP v1) — Android push delivery. Provide a
    // Google service-account JSON key file (with the Firebase Cloud Messaging
    // API enabled) via FCM_CREDENTIALS_PATH. When unset the dispatcher silently
    // skips Android tokens, so iOS delivery is unaffected.
    'fcm' => [
        'credentials_path' => env('FCM_CREDENTIALS_PATH'),
        // Optional override; otherwise read from the service-account JSON.
        'project_id' => env('FCM_PROJECT_ID'),
    ],

    'stripe' => [
        'publishable_key' => env('STRIPE_PUBLISHABLE_KEY'),
    ],

    'apple_pay' => [
        'merchant_id' => env('APPLE_PAY_MERCHANT_ID'),
    ],

    'linkfit' => [
        'web_url' => env('LINKFIT_WEB_URL', env('APP_URL')),
        'web_locale' => env('LINKFIT_WEB_LOCALE', 'az'),
        'logo_url' => env('LINKFIT_LOGO_URL'),
        'admin_url' => env('LINKFIT_ADMIN_URL', env('APP_URL')),
        'owner_url' => env('LINKFIT_OWNER_URL', env('APP_URL')),
        'support_email' => env('LINKFIT_SUPPORT_EMAIL', 'support@linkfit.az'),
        'latest_version' => env('LINKFIT_LATEST_VERSION', '1.0.0'),
        'ios_latest_build' => env('LINKFIT_IOS_LATEST_BUILD', 13),
        'ios_min_supported_build' => env('LINKFIT_IOS_MIN_SUPPORTED_BUILD', 1),
        'ios_force_update' => env('LINKFIT_IOS_FORCE_UPDATE', false),
        'ios_release_notes_url' => env('LINKFIT_IOS_RELEASE_NOTES_URL'),
    ],

];
