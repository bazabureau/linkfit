<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Constrains the client-supplied media URLs we store and re-serve to other
 * users (story media_url, chat attachment_url, profile photo_url).
 *
 * Two safe ways to supply media:
 *   1. Reference a server-owned media_assets row (the PREFERRED path): the asset
 *      must exist, be owned by the requester, and not be soft-deleted; its
 *      server-derived URL is returned. The client never controls the stored URL.
 *   2. Pass a free-form URL that must be https AND whose host is in the
 *      config('media.allowed_hosts') allowlist (the configured app/CDN/media
 *      disk domains). Anything else is rejected with a 422.
 *
 * This blocks arbitrary off-domain URLs (stored-URL / SSRF-adjacent / privacy
 * leak) from being persisted and served cross-user.
 */
trait ValidatesMediaUrls
{
    /**
     * Resolve a server-owned media asset's URL, asserting the requester owns it.
     */
    protected function resolveOwnedMediaAssetUrl(string $mediaAssetId, string $userId): string
    {
        $asset = DB::table('media_assets')->where('id', $mediaAssetId)->first(['user_id', 'url', 'deleted_at']);
        if ($asset === null || ($asset->deleted_at ?? null) !== null || (string) $asset->user_id !== $userId) {
            throw ApiException::validation('Unknown media_asset_id');
        }

        return (string) $asset->url;
    }

    /**
     * Validate a free-form media URL: https scheme + host in the configured
     * allowlist. Returns the URL on success, throws a 422 otherwise.
     */
    protected function assertAllowedMediaUrl(string $url): string
    {
        $parts = parse_url($url);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $allowed = array_values(array_filter((array) config('media.allowed_hosts', [])));

        if ($scheme !== 'https' || $host === '' || ! in_array($host, $allowed, true)) {
            throw ApiException::validation('media_url host is not allowed; upload via media and reference media_asset_id, or use an https URL on an approved host');
        }

        return $url;
    }
}
