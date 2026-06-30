<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Services\Launch\LaunchConfig;

/**
 * Shared serializers that bring the discovery slice's raw-row endpoints into
 * line with the canonical wire shapes the rest of the API already emits:
 *
 *   - {@see discoveryGamePayload()} mirrors GamesController::summaryPayload — the
 *     shape `GET /games` returns and both the web `Game` type and the Flutter
 *     `Game` model decode (nested `host`, float lat/lng, ISO `starts_at`, int
 *     casts, pricing, `match_type`/`currency` defaults).
 *   - {@see discoveryPlayerPayload()} mirrors SocialController::playerPayload —
 *     the shape `GET /players` returns and the web `Player` type / Flutter
 *     `PlayerProfile` decode (username, badges, followers_count, last_seen_at,
 *     is_online, …). The `$extra` overlay carries the matchmaking-/suggestion-
 *     specific fields the iOS cards additionally require (score, reasons, …).
 *
 * Reused (read-only) field math from the canonical controllers so the discovery
 * endpoints can't drift out of sync with them again. The host class is expected
 * to provide `iso()` (ApiController) — all discovery callers extend it.
 */
trait SerializesDiscoveryEntities
{
    /**
     * Canonical game wire shape (parity with GamesController::summaryPayload).
     * `$r` is a raw query row that selected the same host/court/venue columns the
     * games index selects (host_username/host_photo_url/host_elo, court_name,
     * venue_*, hourly_price_minor, currency, …).
     *
     * @return array<string,mixed>
     */
    protected function discoveryGamePayload(object $r): array
    {
        return [
            'id' => $r->id,
            'sport_id' => $r->sport_id ?? null,
            'sport_slug' => $r->sport_slug ?? null,
            'host_user_id' => $r->host_user_id ?? null,
            'host_display_name' => $r->host_display_name ?? null,
            // Nested host object consumed by the web client + Flutter GameHost.
            'host' => ($r->host_user_id ?? null) !== null ? [
                'id' => $r->host_user_id,
                'username' => $r->host_username ?? null,
                'display_name' => $r->host_display_name ?? null,
                'photo_url' => $r->host_photo_url ?? null,
                'elo' => isset($r->host_elo) && $r->host_elo !== null ? (int) $r->host_elo : null,
            ] : null,
            'court_id' => $r->court_id ?? null,
            'court_name' => $r->court_name ?? null,
            'venue_id' => $r->venue_id ?? null,
            'venue_name' => $r->venue_name ?? null,
            'venue_address' => $r->venue_address ?? null,
            'venue_photo_url' => $r->venue_photo_url ?? null,
            'lat' => isset($r->lat) && $r->lat !== null ? (float) $r->lat : null,
            'lng' => isset($r->lng) && $r->lng !== null ? (float) $r->lng : null,
            'starts_at' => $this->iso($r->starts_at ?? null),
            'duration_minutes' => (int) ($r->duration_minutes ?? 0),
            'capacity' => (int) ($r->capacity ?? 0),
            'participants_count' => (int) ($r->participants_count ?? 0),
            'status' => $r->status ?? null,
            'visibility' => $r->visibility ?? null,
            'match_type' => $r->match_type ?? 'casual',
            'skill_min_elo' => isset($r->skill_min_elo) && $r->skill_min_elo !== null ? (int) $r->skill_min_elo : null,
            'skill_max_elo' => isset($r->skill_max_elo) && $r->skill_max_elo !== null ? (int) $r->skill_max_elo : null,
            'distance_km' => isset($r->distance_m) && $r->distance_m !== null
                ? round(((float) $r->distance_m) / 1000, 2)
                : null,
            'price_minor' => $this->discoveryPerPlayerPriceMinor($r),
            'total_minor' => $this->discoveryTotalPriceMinor($r),
            'currency' => $r->currency ?? 'AZN',
            // The matchmaking/home game lists are roster-less by design (the count
            // is authoritative); the key stays present + correctly typed so typed
            // clients decode the same `participants: GameParticipant[]` contract.
            'participants' => [],
        ];
    }

    /** Total game price in minor units — parity with GamesController::totalPriceMinor. */
    protected function discoveryTotalPriceMinor(object $r): ?int
    {
        if (! app(LaunchConfig::class)->monetizationEnabled()) {
            return 0;
        }
        if (($r->hourly_price_minor ?? null) === null) {
            return null;
        }

        return (int) round(((int) $r->hourly_price_minor) * ((int) ($r->duration_minutes ?? 60)) / 60);
    }

    /** Per-player price in minor units — parity with GamesController::perPlayerPriceMinor. */
    protected function discoveryPerPlayerPriceMinor(object $r): ?int
    {
        $total = $this->discoveryTotalPriceMinor($r);
        $capacity = (int) ($r->capacity ?? 0);
        if ($total === null || $capacity <= 0) {
            return null;
        }

        return (int) ceil($total / $capacity);
    }

    /**
     * Canonical player wire shape (parity with SocialController::playerPayload).
     * `$extra` overlays endpoint-specific fields (e.g. the iOS RecommendedPlayer /
     * SuggestedFollowItem extras) ON TOP of the shared base, so a discovery list
     * stays a strict superset of the canonical Player shape.
     *
     * @param  array<string,mixed>  $extra
     * @return array<string,mixed>
     */
    protected function discoveryPlayerPayload(object $u, array $extra = []): array
    {
        return array_merge([
            'id' => $u->id,
            'username' => $u->username ?? null,
            'display_name' => $u->display_name,
            'photo_url' => $u->photo_url,
            'primary_sport' => $u->primary_sport ?? null,
            'primary_elo' => isset($u->primary_elo) && $u->primary_elo !== null ? (int) $u->primary_elo : null,
            'reliability_score' => isset($u->reliability_score) && $u->reliability_score !== null ? (int) $u->reliability_score : null,
            'distance_km' => null,
            'is_followed_by_me' => (bool) ($u->is_followed_by_me ?? false),
            'followers_count' => (int) ($u->followers_count ?? 0),
            'last_seen_at' => $this->iso($u->last_seen_at ?? null),
            'is_online' => $this->discoveryIsOnline($u->last_seen_at ?? null),
        ], $this->discoveryBadgeFields($u), $extra);
    }

    /** Public badge flags — parity with SocialController::badgeFields. */
    protected function discoveryBadgeFields(object $u): array
    {
        $vipActive = (bool) ($u->is_vip ?? false)
            && (empty($u->vip_expires_at) || strtotime((string) $u->vip_expires_at) > time());

        return [
            'is_vip' => $vipActive,
            'vip_label' => $vipActive ? (trim((string) ($u->vip_badge_label ?? '')) ?: 'VIP') : null,
            'is_verified' => (bool) ($u->is_verified ?? false),
            'is_ambassador' => (bool) ($u->is_ambassador ?? false),
            'founder_role' => $u->founder_role ?? null,
        ];
    }

    /** Online = seen in the last 2 minutes — parity with SocialController::isOnline. */
    protected function discoveryIsOnline(mixed $lastSeenAt): bool
    {
        if ($lastSeenAt === null) {
            return false;
        }

        $timestamp = strtotime((string) $lastSeenAt);

        return $timestamp !== false && $timestamp >= now()->subMinutes(2)->getTimestamp();
    }
}
