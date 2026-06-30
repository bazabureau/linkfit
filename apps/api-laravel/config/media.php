<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Allowed media hosts
    |--------------------------------------------------------------------------
    |
    | Free-form media URLs accepted from clients (story media_url, chat
    | attachment_url, profile photo_url) must be https and point at one of these
    | hosts. This prevents storing/serving arbitrary off-domain URLs
    | (stored-URL / SSRF-adjacent / privacy leak). The list is derived from the
    | app URL and the configured media disk URL, plus any explicit hosts in
    | MEDIA_ALLOWED_HOSTS (comma-separated). The PREFERRED path is to upload via
    | MediaController and reference the returned media_asset_id, which is
    | resolved to a server-owned URL and never goes through this allowlist.
    |
    */

    'allowed_hosts' => array_values(array_unique(array_filter(array_map(
        static fn ($value) => strtolower(trim((string) $value)),
        array_merge(
            explode(',', (string) env('MEDIA_ALLOWED_HOSTS', '')),
            [
                parse_url((string) env('APP_URL', ''), PHP_URL_HOST) ?: '',
                parse_url((string) env('AWS_URL', ''), PHP_URL_HOST) ?: '',
                parse_url((string) env('MEDIA_CDN_URL', ''), PHP_URL_HOST) ?: '',
            ],
        ),
    )))),

    /*
    |--------------------------------------------------------------------------
    | Private media purposes
    |--------------------------------------------------------------------------
    |
    | Uploads with one of these purposes (chat images / videos / voice notes)
    | are stored on a NON-public disk and served ONLY through the signature-
    | checked media.serve route — never a direct, permanent, guessable-once-
    | leaked public URL. Other purposes (e.g. avatars, which use their own
    | endpoint) keep their direct public URL.
    |
    */

    'private_purposes' => array_values(array_filter(array_map(
        static fn ($value) => trim((string) $value),
        explode(',', (string) env('MEDIA_PRIVATE_PURPOSES', 'message_image,message_video,message_voice,voice,audio')),
    ))),

    'private_disk' => env('MEDIA_PRIVATE_DISK', 'local'),

    // Lifetime of a signed media URL. A fresh one is generated every time a
    // message is serialized for an authorised viewer, so this only needs to
    // outlast an open chat session — far short of "permanent". Default 7 days.
    'signed_ttl_minutes' => (int) env('MEDIA_SIGNED_TTL_MINUTES', 10080),

];
