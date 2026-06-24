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

];
