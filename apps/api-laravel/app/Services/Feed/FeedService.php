<?php

namespace App\Services\Feed;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * FeedService — the single chokepoint for writing activity-feed events, plus
 * the pull-based fan-out producer that synthesizes those events from the
 * source-of-truth tables (game joins, match results, partnerships, ELO
 * milestones, tournament entries, follows).
 *
 * Why a producer service (vs. inline emission in each controller):
 *   - Emission must never be on the request hot-path nor inside the producer
 *     controllers' transactions — a feed write failing must not roll back a
 *     game-result or a follow. The fan-out reads committed source rows after
 *     the fact, so it's decoupled and crash-safe.
 *   - It is idempotent end-to-end. Every synthesized row carries a
 *     `source_key` in its payload; the partial unique index
 *     `feed_events_dedupe_idx (actor_user_id, type, (payload->>'source_key'))`
 *     drops re-emissions, so a re-run (or two overlapping runs) never produces
 *     duplicates. `record()` therefore uses INSERT ... ON CONFLICT DO NOTHING.
 *   - Per-source watermarks live in `feed_cursor` (one row per source). A
 *     watermark is only advanced AFTER its batch is emitted, so a crash
 *     mid-batch is safe to retry — the dedupe index absorbs the overlap.
 *
 * Invoked once a minute by the `feed:fanout` Artisan command (see
 * routes/console.php). The HTTP read path lives in FeedController.
 */
class FeedService
{
    /**
     * Feed-cursor source keys. Keep these stable — they are the primary key of
     * `feed_cursor`. A failure in one source never blocks another.
     */
    private const SOURCE_GAME_JOINS = 'game_joins';

    private const SOURCE_MATCH_RESULTS = 'match_results';

    private const SOURCE_TOURNAMENT_ENTRIES = 'tournament_entries';

    private const SOURCE_FOLLOWS = 'follows';

    /** UNIX epoch — the implicit watermark for a source we've never polled. */
    private const EPOCH = '1970-01-01 00:00:00+00';

    /** Per-source batch ceiling so a backlog can't blow up a single tick. */
    private const BATCH_LIMIT = 500;

    /**
     * Record a single feed event through the one write path.
     *
     * Visibility tri-state: `public` shows everywhere, `followers` (default)
     * is seen only by the actor's followers + the actor, `private` is the
     * actor-only diagnostic value.
     *
     * When $sourceKey is provided the row is keyed by (actor, type, sourceKey)
     * via the partial unique index and any re-emission is silently dropped.
     * Without a source key the dedupe index's WHERE clause excludes the row,
     * so the insert proceeds unconditionally (ad-hoc events are never deduped).
     *
     * Returns the new event id when a row was inserted, or null when the
     * insert was a deduped no-op.
     *
     * @param  array<string,mixed>  $payload
     */
    public function record(
        string $type,
        string $actorUserId,
        array $payload = [],
        string $visibility = 'followers',
        ?string $sourceKey = null,
    ): ?string {
        if ($sourceKey !== null) {
            $payload['source_key'] = $sourceKey;
        }

        $id = (string) Str::uuid();

        // Postgres path: INSERT ... ON CONFLICT DO NOTHING against the partial
        // unique dedupe index. We let the DB decide whether the row is new and
        // read back the inserted id via RETURNING; an empty result means the
        // conflict fired (already emitted) → null.
        if (DB::connection()->getDriverName() === 'pgsql') {
            $inserted = DB::select(
                'INSERT INTO feed_events (id, actor_user_id, type, payload, visibility, created_at)
                 VALUES (?::uuid, ?::uuid, ?::feed_event_type, ?::jsonb, ?::feed_visibility, now())
                 ON CONFLICT (actor_user_id, type, (payload->>\'source_key\'))
                   WHERE payload ? \'source_key\'
                 DO NOTHING
                 RETURNING id',
                [$id, $actorUserId, $type, json_encode($payload), $visibility],
            );

            return $inserted === [] ? null : (string) $inserted[0]->id;
        }

        // Portable fallback (sqlite in tests): emulate the dedupe with an
        // explicit existence check inside a transaction, then insert.
        return DB::transaction(function () use ($id, $type, $actorUserId, $payload, $visibility, $sourceKey) {
            if ($sourceKey !== null) {
                $dupe = DB::table('feed_events')
                    ->where('actor_user_id', $actorUserId)
                    ->where('type', $type)
                    ->whereRaw("json_extract(payload, '$.source_key') = ?", [$sourceKey])
                    ->exists();
                if ($dupe) {
                    return null;
                }
            }
            DB::table('feed_events')->insert([
                'id' => $id,
                'actor_user_id' => $actorUserId,
                'type' => $type,
                'payload' => json_encode($payload),
                'visibility' => $visibility,
                'created_at' => now(),
            ]);

            return $id;
        });
    }

    /**
     * Run one fan-out pass across every source. Returns a per-source count of
     * the feed events actually emitted this tick (deduped no-ops are not
     * counted). Each source is wrapped so a failure in one is logged-as-thrown
     * by the caller but the others still run via independent watermarks.
     *
     * @return array<string,int>
     */
    public function fanOut(): array
    {
        return [
            'game_joins' => $this->processGameJoins(),
            'match_results' => $this->processMatchResults(),
            'tournament_entries' => $this->processTournamentEntries(),
            'follows' => $this->processFollows(),
        ];
    }

    // ── Source: game_participants → joined_game ─────────────────────────────

    private function processGameJoins(): int
    {
        $since = $this->watermark(self::SOURCE_GAME_JOINS);

        $rows = DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('gp.joined_at', '>', $since)
            ->where('gp.status', 'confirmed')
            ->orderBy('gp.joined_at')
            ->limit(self::BATCH_LIMIT)
            ->get([
                'gp.game_id', 'gp.user_id', 'gp.joined_at',
                'g.host_user_id', 's.slug as sport_slug', 's.name as sport_name',
                'v.name as venue_name',
            ]);

        $emitted = 0;
        $max = $since;
        foreach ($rows as $r) {
            $isHost = $r->user_id === $r->host_user_id;
            $new = $this->record(
                type: 'joined_game',
                actorUserId: (string) $r->user_id,
                payload: [
                    'game_id' => (string) $r->game_id,
                    'sport_slug' => $r->sport_slug,
                    'sport_name' => $r->sport_name,
                    'venue_name' => $r->venue_name,
                    'is_host' => $isHost,
                ],
                sourceKey: 'gp:'.$r->game_id.':'.$r->user_id,
            );
            if ($new !== null) {
                $emitted++;
            }
            if ($r->joined_at > $max) {
                $max = $r->joined_at;
            }
        }

        if ($rows->isNotEmpty()) {
            $this->setWatermark(self::SOURCE_GAME_JOINS, $max);
        }

        return $emitted;
    }

    // ── Source: match_scores → won_match + new_partnership + elo_milestone ──

    /**
     * Completed matches are the authoritative result write (MatchController
     * applies ELO + win/loss in the same transaction that sets `completed_at`).
     * Sourcing from here — rather than the legacy ratings-recompute signal —
     * makes "who won" exact (derived from the recorded sets) and lets us emit
     * three related event families off one watermark:
     *
     *   - `won_match`      → each user on the winning team
     *   - `new_partnership`→ each NEW teammate pair (first time those two play
     *                        on the same team in any completed match)
     *   - `elo_milestone`  → any winning-team player whose post-match ELO has
     *                        crossed a multiple of 100 at/above 1300
     */
    private function processMatchResults(): int
    {
        $since = $this->watermark(self::SOURCE_MATCH_RESULTS);

        $rows = DB::table('match_scores as ms')
            ->join('games as g', 'g.id', '=', 'ms.game_id')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->where('ms.status', 'completed')
            ->whereNotNull('ms.completed_at')
            ->where('ms.completed_at', '>', $since)
            ->orderBy('ms.completed_at')
            ->limit(self::BATCH_LIMIT)
            ->get([
                'ms.game_id', 'ms.team_a_user_ids', 'ms.team_b_user_ids',
                'ms.sets', 'ms.elo_delta_by_user', 'ms.completed_at',
                'g.sport_id', 's.slug as sport_slug', 's.name as sport_name',
            ]);

        $emitted = 0;
        $max = $since;
        $milestoneUserSports = [];

        foreach ($rows as $r) {
            $teamA = $this->uuidArray($r->team_a_user_ids);
            $teamB = $this->uuidArray($r->team_b_user_ids);
            $winner = $this->winnerFromSets($this->jsonArray($r->sets));

            // won_match — one per winning-team member.
            if ($winner !== null) {
                $winners = $winner === 'a' ? $teamA : $teamB;
                foreach ($winners as $uid) {
                    $new = $this->record(
                        type: 'won_match',
                        actorUserId: $uid,
                        payload: [
                            'game_id' => (string) $r->game_id,
                            'sport_slug' => $r->sport_slug,
                            'sport_name' => $r->sport_name,
                        ],
                        visibility: 'public',
                        sourceKey: 'match:'.$r->game_id.':'.$uid,
                    );
                    if ($new !== null) {
                        $emitted++;
                    }
                    $milestoneUserSports[$uid] = (string) $r->sport_id;
                }
            }

            // new_partnership — each teammate pair, deduped to the FIRST time
            // ever via the (actor, type, source_key) index. Actor is the
            // alphabetically-lower id so the pair maps to one canonical event.
            foreach ([$teamA, $teamB] as $team) {
                foreach ($this->pairs($team) as [$lo, $hi]) {
                    $new = $this->record(
                        type: 'new_partnership',
                        actorUserId: $lo,
                        payload: [
                            'partner_user_id' => $hi,
                            'game_id' => (string) $r->game_id,
                            'sport_slug' => $r->sport_slug,
                            'sport_name' => $r->sport_name,
                        ],
                        sourceKey: 'partnership:'.$lo.':'.$hi,
                    );
                    if ($new !== null) {
                        $emitted++;
                    }
                }
            }

            if ($r->completed_at > $max) {
                $max = $r->completed_at;
            }
        }

        // elo_milestone — read CURRENT stats for the winners in this batch and
        // emit one event per crossed multiple of 100 (>=1300). The source_key
        // carries the exact rating so the same milestone is emitted at most
        // once per (user, sport, rating).
        $emitted += $this->emitEloMilestones($milestoneUserSports);

        if ($rows->isNotEmpty()) {
            $this->setWatermark(self::SOURCE_MATCH_RESULTS, $max);
        }

        return $emitted;
    }

    /**
     * @param  array<string,string>  $userSports  user_id => sport_id
     */
    private function emitEloMilestones(array $userSports): int
    {
        if ($userSports === []) {
            return 0;
        }

        $emitted = 0;
        $stats = DB::table('player_sport_stats as pss')
            ->join('sports as s', 's.id', '=', 'pss.sport_id')
            ->whereIn('pss.user_id', array_keys($userSports))
            ->get(['pss.user_id', 'pss.sport_id', 'pss.elo_rating', 's.slug as sport_slug', 's.name as sport_name']);

        foreach ($stats as $st) {
            // Only the sport the user just played in this batch is relevant.
            if (($userSports[$st->user_id] ?? null) !== (string) $st->sport_id) {
                continue;
            }
            $elo = (int) $st->elo_rating;
            if ($elo >= 1300 && $elo % 100 === 0) {
                $new = $this->record(
                    type: 'elo_milestone',
                    actorUserId: (string) $st->user_id,
                    payload: [
                        'sport_slug' => $st->sport_slug,
                        'sport_name' => $st->sport_name,
                        'elo_rating' => $elo,
                    ],
                    visibility: 'public',
                    sourceKey: 'elo:'.$st->user_id.':'.$st->sport_slug.':'.$elo,
                );
                if ($new !== null) {
                    $emitted++;
                }
            }
        }

        return $emitted;
    }

    // ── Source: tournament_entries → registered_tournament ──────────────────

    private function processTournamentEntries(): int
    {
        $since = $this->watermark(self::SOURCE_TOURNAMENT_ENTRIES);

        $rows = DB::table('tournament_entries as te')
            ->join('tournaments as t', 't.id', '=', 'te.tournament_id')
            ->where('te.created_at', '>', $since)
            ->whereIn('te.status', ['pending', 'confirmed'])
            ->orderBy('te.created_at')
            ->limit(self::BATCH_LIMIT)
            ->get([
                'te.id', 'te.tournament_id', 'te.captain_user_id', 'te.squad_name',
                'te.created_at', 't.name as tournament_name',
            ]);

        $emitted = 0;
        $max = $since;
        foreach ($rows as $r) {
            $new = $this->record(
                type: 'registered_tournament',
                actorUserId: (string) $r->captain_user_id,
                payload: [
                    'tournament_id' => (string) $r->tournament_id,
                    'tournament_name' => $r->tournament_name,
                    'squad_name' => $r->squad_name,
                ],
                sourceKey: 'te:'.$r->id,
            );
            if ($new !== null) {
                $emitted++;
            }
            if ($r->created_at > $max) {
                $max = $r->created_at;
            }
        }

        if ($rows->isNotEmpty()) {
            $this->setWatermark(self::SOURCE_TOURNAMENT_ENTRIES, $max);
        }

        return $emitted;
    }

    // ── Source: follows → followed_user ─────────────────────────────────────

    private function processFollows(): int
    {
        $since = $this->watermark(self::SOURCE_FOLLOWS);

        $rows = DB::table('follows')
            ->where('created_at', '>', $since)
            ->orderBy('created_at')
            ->limit(self::BATCH_LIMIT)
            ->get(['follower_user_id', 'followed_user_id', 'created_at']);

        $emitted = 0;
        $max = $since;
        foreach ($rows as $r) {
            $new = $this->record(
                type: 'followed_user',
                actorUserId: (string) $r->follower_user_id,
                payload: ['followed_user_id' => (string) $r->followed_user_id],
                sourceKey: 'follow:'.$r->follower_user_id.':'.$r->followed_user_id,
            );
            if ($new !== null) {
                $emitted++;
            }
            if ($r->created_at > $max) {
                $max = $r->created_at;
            }
        }

        if ($rows->isNotEmpty()) {
            $this->setWatermark(self::SOURCE_FOLLOWS, $max);
        }

        return $emitted;
    }

    // ── Server-rendered copy (title / summary / body) ───────────────────────

    /**
     * Project a feed event into human copy the client can render verbatim.
     * Centralizing this server-side means every client (iOS, web, digest
     * email) shows identical wording and the templates can change without an
     * app release. `body` is a longer variant for detail surfaces; `summary`
     * is the one-liner for the timeline card; `title` is the bold lead-in.
     *
     * @param  array<string,mixed>  $payload
     * @return array{title:string,summary:string,body:string}
     */
    public function summarize(string $type, array $payload, string $actorName): array
    {
        $sport = $this->copySport($payload);
        $venue = isset($payload['venue_name']) && $payload['venue_name'] !== null
            ? (string) $payload['venue_name']
            : null;

        return match ($type) {
            'joined_game' => $this->copyJoinedGame($actorName, $sport, $venue, (bool) ($payload['is_host'] ?? false)),
            'won_match' => [
                'title' => $actorName.' won a match',
                'summary' => $actorName.' won a '.$sport.' match',
                'body' => $actorName.' came out on top in a '.$sport.' match. Nice win!',
            ],
            'registered_tournament' => $this->copyTournament($actorName, $payload),
            'elo_milestone' => $this->copyEloMilestone($actorName, $sport, (int) ($payload['elo_rating'] ?? 0)),
            'followed_user' => [
                'title' => $actorName.' followed someone',
                'summary' => $actorName.' started following a new player',
                'body' => $actorName.' is growing their padel network — they just followed a new player.',
            ],
            'new_partnership' => [
                'title' => 'New partnership',
                'summary' => $actorName.' teamed up with a new partner',
                'body' => $actorName.' played their first match alongside a new partner. A duo is born!',
            ],
            default => [
                'title' => $actorName,
                'summary' => $actorName.' has new activity',
                'body' => $actorName.' has new activity on LinkFit.',
            ],
        };
    }

    /**
     * @param  array<string,mixed>  $payload
     * @return array{title:string,summary:string,body:string}
     */
    private function copyJoinedGame(string $actorName, string $sport, ?string $venue, bool $isHost): array
    {
        $verb = $isHost ? 'is hosting' : 'joined';
        $at = $venue !== null ? ' at '.$venue : '';
        $summary = $actorName.' '.$verb.' a '.$sport.' game'.$at;

        return [
            'title' => $isHost ? $actorName.' is hosting a game' : $actorName.' joined a game',
            'summary' => $summary,
            'body' => $summary.'. Tap to see the details and request a spot.',
        ];
    }

    /**
     * @param  array<string,mixed>  $payload
     * @return array{title:string,summary:string,body:string}
     */
    private function copyTournament(string $actorName, array $payload): array
    {
        $tournament = isset($payload['tournament_name']) ? (string) $payload['tournament_name'] : 'a tournament';
        $squad = isset($payload['squad_name']) ? (string) $payload['squad_name'] : null;
        $with = $squad !== null ? ' with squad '.$squad : '';

        return [
            'title' => $actorName.' registered for a tournament',
            'summary' => $actorName.' registered for '.$tournament.$with,
            'body' => $actorName.' signed up for '.$tournament.$with.'. Good luck on the court!',
        ];
    }

    /**
     * @return array{title:string,summary:string,body:string}
     */
    private function copyEloMilestone(string $actorName, string $sport, int $elo): array
    {
        return [
            'title' => $actorName.' hit a new milestone',
            'summary' => $actorName.' reached '.$elo.' ELO in '.$sport,
            'body' => $actorName.' just crossed '.$elo.' ELO in '.$sport.'. The grind is paying off!',
        ];
    }

    /**
     * @param  array<string,mixed>  $payload
     */
    private function copySport(array $payload): string
    {
        if (isset($payload['sport_name']) && $payload['sport_name'] !== null && $payload['sport_name'] !== '') {
            return (string) $payload['sport_name'];
        }
        if (isset($payload['sport_slug']) && $payload['sport_slug'] !== null && $payload['sport_slug'] !== '') {
            return ucfirst((string) $payload['sport_slug']);
        }

        return 'padel';
    }

    // ── Watermark helpers ───────────────────────────────────────────────────

    private function watermark(string $source): string
    {
        $row = DB::table('feed_cursor')->where('source', $source)->first(['watermark']);
        if ($row === null) {
            return self::EPOCH;
        }

        return (string) $row->watermark;
    }

    private function setWatermark(string $source, string $watermark): void
    {
        DB::table('feed_cursor')->updateOrInsert(
            ['source' => $source],
            ['watermark' => $watermark, 'updated_at' => now()],
        );
    }

    // ── Low-level helpers ───────────────────────────────────────────────────

    /**
     * Replicates MatchController::winnerFromSets — the winner is the team that
     * took more sets; a tie (or no decisive set) yields null.
     *
     * @param  array<int,array<string,mixed>>  $sets
     */
    private function winnerFromSets(array $sets): ?string
    {
        $a = 0;
        $b = 0;
        foreach ($sets as $s) {
            $sa = (int) ($s['a'] ?? 0);
            $sb = (int) ($s['b'] ?? 0);
            if ($sa > $sb) {
                $a++;
            } elseif ($sb > $sa) {
                $b++;
            }
        }
        if ($a === $b) {
            return null;
        }

        return $a > $b ? 'a' : 'b';
    }

    /**
     * Distinct unordered pairs of a team's members, each returned as
     * [lowerId, higherId] so a pair maps to one canonical (actor, partner)
     * regardless of array order.
     *
     * @param  array<int,string>  $team
     * @return array<int,array{0:string,1:string}>
     */
    private function pairs(array $team): array
    {
        $team = array_values(array_unique($team));
        $out = [];
        $n = count($team);
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                $pair = [$team[$i], $team[$j]];
                sort($pair);
                $out[] = [$pair[0], $pair[1]];
            }
        }

        return $out;
    }

    /**
     * Normalize a Postgres uuid[] (which the driver hands back as the literal
     * `{a,b}` string) or an already-decoded array into a clean list of ids.
     *
     * @return array<int,string>
     */
    private function uuidArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_map('strval', $value));
        }
        $raw = trim((string) $value, '{}');
        if ($raw === '') {
            return [];
        }

        return array_values(array_filter(array_map(
            fn ($v) => trim($v, '"'),
            explode(',', $raw),
        )));
    }

    /**
     * Decode a jsonb column that the driver may hand back as a JSON string or
     * an already-decoded array.
     *
     * @return array<int|string,mixed>
     */
    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? $decoded : [];
    }
}
