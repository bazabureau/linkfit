<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Auto-hide threshold
    |--------------------------------------------------------------------------
    |
    | The number of DISTINCT reporters who must file a pending report against
    | the same target before its content is automatically hidden from public
    | read paths (Apple Guideline 1.2). Users are never auto-suspended — only
    | their content is hidden — to limit coordinated "brigading" abuse.
    |
    */

    'autohide_threshold' => env('MODERATION_AUTOHIDE_THRESHOLD', 3),

    /*
    |--------------------------------------------------------------------------
    | Moderation alert email
    |--------------------------------------------------------------------------
    |
    | When set, every newly filed report sends a best-effort notification here
    | so a human can action it within 24 hours. Unset = no email is sent.
    |
    */

    'alert_email' => env('MODERATION_ALERT_EMAIL'),

];
