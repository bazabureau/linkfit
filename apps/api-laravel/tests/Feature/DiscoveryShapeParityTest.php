<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\DiscoveryController;
use App\Http\Controllers\Api\GamesController;
use App\Http\Controllers\Api\SocialController;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Locks the discovery slice's game/player payloads to the SAME wire shape the
 * canonical controllers emit, so the typed Flutter (`Game`/`PlayerProfile`) and
 * web (`Game`/`Player`) clients decode discovery rows exactly like `GET /games`
 * and `GET /players`.
 *
 * Drives the shared serializers (DiscoveryController) and the canonical builders
 * (GamesController::summaryPayload / SocialController::playerPayload) directly
 * with an equivalent raw row, then asserts key + type parity. No DB / HTTP is
 * needed — the postgres-only discovery queries are exercised in production; this
 * pins the serialization contract.
 */
class DiscoveryShapeParityTest extends TestCase
{
    /** Anonymous subclass exposing the protected discovery serializers. */
    private function discovery(): DiscoveryController
    {
        return new class extends DiscoveryController
        {
            public function game(object $r): array
            {
                return $this->discoveryGamePayload($r);
            }

            /** @param array<string,mixed> $extra */
            public function player(object $u, array $extra = []): array
            {
                return $this->discoveryPlayerPayload($u, $extra);
            }
        };
    }

    private function gameRow(): object
    {
        // lat/lng as strings (Postgres returns numeric columns as strings via PDO)
        // so the test pins the float-cast that keeps typed clients from choking.
        return (object) [
            'id' => 'game-1',
            'sport_id' => 'sport-1',
            'sport_slug' => 'padel',
            'host_user_id' => 'host-1',
            'host_username' => 'hostuser',
            'host_display_name' => 'Host User',
            'host_photo_url' => 'https://cdn/h.jpg',
            'host_elo' => '1450',
            'court_id' => 'court-1',
            'court_name' => 'Court 1',
            'hourly_price_minor' => 6000,
            'currency' => 'AZN',
            'venue_id' => 'venue-1',
            'venue_name' => 'Central Court',
            'venue_address' => 'Baku',
            'venue_photo_url' => 'https://cdn/v.jpg',
            'lat' => '40.4093',
            'lng' => '49.8671',
            'starts_at' => '2026-07-01 10:00:00',
            'duration_minutes' => 90,
            'capacity' => 4,
            'status' => 'open',
            'visibility' => 'public',
            'match_type' => 'casual',
            'skill_min_elo' => 1000,
            'skill_max_elo' => 1800,
            'distance_m' => null,
            'participants_count' => 2,
            // Columns summaryPayload reads but the discovery list doesn't surface.
            'created_at' => '2026-06-01 10:00:00',
        ];
    }

    private function playerRow(): object
    {
        return (object) [
            'id' => 'user-1',
            'username' => 'alice',
            'display_name' => 'Alice',
            'photo_url' => 'https://cdn/a.jpg',
            'primary_sport' => 'padel',
            'primary_elo' => '1320',
            'reliability_score' => '95',
            'followers_count' => 7,
            'last_seen_at' => null,
            'is_vip' => false,
            'vip_expires_at' => null,
            'vip_badge_label' => null,
            'is_verified' => false,
            'is_ambassador' => false,
        ];
    }

    public function test_discovery_game_payload_matches_canonical_games_shape(): void
    {
        $row = $this->gameRow();
        $discovery = $this->discovery()->game($row);
        $canonical = $this->canonical(GamesController::class, 'summaryPayload', [$row, []]);

        // Exact key-set parity with `GET /games` summary rows.
        $this->assertEqualsCanonicalizing(
            array_keys($canonical),
            array_keys($discovery),
            'Discovery game payload keys drifted from GamesController::summaryPayload',
        );

        // Type parity on every shared key (catches snake/camel-safe drifts like
        // int-vs-string ids, raw-vs-ISO timestamps, bool-vs-0/1).
        foreach ($canonical as $key => $value) {
            $this->assertSame(
                gettype($value),
                gettype($discovery[$key]),
                "Discovery game payload type drift on `{$key}`",
            );
        }

        // Nested host object parity (the field the matchmaking list was missing).
        $this->assertIsArray($discovery['host']);
        $this->assertEqualsCanonicalizing(array_keys($canonical['host']), array_keys($discovery['host']));

        // Load-bearing type pins.
        $this->assertIsFloat($discovery['lat']);
        $this->assertIsFloat($discovery['lng']);
        $this->assertIsInt($discovery['capacity']);
        $this->assertIsInt($discovery['duration_minutes']);
        $this->assertIsInt($discovery['participants_count']);
        $this->assertIsInt($discovery['host']['elo']);
        $this->assertIsArray($discovery['participants']);
        $this->assertSame($canonical['starts_at'], $discovery['starts_at']);
        $this->assertStringEndsWith('Z', $discovery['starts_at']);
    }

    public function test_discovery_player_payload_is_a_superset_of_canonical_player_shape(): void
    {
        $row = $this->playerRow();
        $extra = [
            'user_id' => $row->id,
            'mutual_followers_count' => 2,
            'score' => 5.0,
            'reasons' => ['Eyni idman növü'],
        ];
        $discovery = $this->discovery()->player($row, $extra);
        $canonical = $this->canonical(SocialController::class, 'playerPayload', [$row, []]);

        // Every canonical Player key is present with the same type.
        foreach ($canonical as $key => $value) {
            $this->assertArrayHasKey($key, $discovery, "Discovery player payload is missing canonical key `{$key}`");
            $this->assertSame(
                gettype($value),
                gettype($discovery[$key]),
                "Discovery player payload type drift on `{$key}`",
            );
        }

        // Load-bearing type pins.
        $this->assertIsInt($discovery['primary_elo']);
        $this->assertIsInt($discovery['reliability_score']);
        $this->assertIsInt($discovery['followers_count']);
        $this->assertIsBool($discovery['is_followed_by_me']);
        $this->assertIsBool($discovery['is_online']);
        $this->assertIsBool($discovery['is_vip']);

        // Endpoint-specific extras survive the overlay (iOS RecommendedPlayer /
        // SuggestedFollowItem depend on them).
        $this->assertSame('user-1', $discovery['user_id']);
        $this->assertSame(2, $discovery['mutual_followers_count']);
        $this->assertSame(5.0, $discovery['score']);
        $this->assertSame(['Eyni idman növü'], $discovery['reasons']);
    }

    /**
     * @param  array<int,mixed>  $args
     * @return array<string,mixed>
     */
    private function canonical(string $class, string $method, array $args): array
    {
        $reflection = new ReflectionMethod($class, $method);
        $reflection->setAccessible(true);

        return $reflection->invoke(app($class), ...$args);
    }
}
