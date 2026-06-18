<?php

namespace Database\Seeders;

use App\Services\Auth\PasswordService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Ramsey\Uuid\Uuid;

/**
 * Demo content for the launch video — makes the app + site look populated with
 * realistic Azerbaijani players, ratings, games, tournaments, reviews and follows.
 *
 * 100% ADDITIVE + IDEMPOTENT: every row uses a deterministic uuid5 id (or a
 * natural unique key) so re-running updates in place and never duplicates. It
 * never deletes or touches pre-existing real data. Demo accounts use
 * demo.<slug>@linkfit.az so they stay identifiable. Run:
 *   php artisan db:seed --class=DemoContentSeeder --force
 */
class DemoContentSeeder extends Seeder
{
    private const NS = '6f1d2c4a-0b3e-4a1f-9c7d-demo000000a1'; // stable namespace-ish seed
    private const PADEL = '29252a05-a1c1-46f0-a5c2-e970d4bb60cc';
    private const TENNIS = '3bc90e32-ef64-4d51-9d14-0aa4d358756d';

    /** venue id => [name, padel court id, lat, lng] */
    private const VENUES = [
        ['id' => 'd0389558-d4cf-4e02-8205-1f4479e773b8', 'name' => 'Top Padel Club Baku', 'court' => '6113df79-b88b-4efc-8974-8b5bdf367717', 'lat' => 40.3782, 'lng' => 49.8516],
        ['id' => '7568ce65-38c4-43e2-a47f-8a5502d2004f', 'name' => 'Padel Center Baku', 'court' => '08d7ecf9-9ed2-4eed-89c3-f3db7d31a310', 'lat' => 40.4093, 'lng' => 49.8671],
        ['id' => '711224f5-ae41-489a-8532-98e8eb0b8f33', 'name' => 'Sea Breeze Resort', 'court' => 'd71640ba-5e80-46cf-a967-bee6b92ba915', 'lat' => 40.6012, 'lng' => 49.9201],
        ['id' => 'd2470fac-2cf7-48cf-be10-23dac8ef177c', 'name' => 'Baku Tennis Club', 'court' => '516ca6e0-bc40-45ad-87bc-52ea4da24554', 'lat' => 40.3955, 'lng' => 49.8821],
        ['id' => 'f6da9e56-dd4e-4909-bc29-77ba2f2c2573', 'name' => 'Baku Tennis Academy', 'court' => 'bd223982-5b7b-4884-a8df-0affc41ca398', 'lat' => 40.4156, 'lng' => 49.9134],
    ];

    /** [name, gender m/f, elo, vip, verified] — ordered roughly by rating. */
    private const PLAYERS = [
        ['Elvin Məmmədov', 'm', 1622, true, true],
        ['Nigar Əliyeva', 'f', 1588, false, true],
        ['Rəşad Hüseynov', 'm', 1544, true, false],
        ['Aysel Məmmədova', 'f', 1512, false, true],
        ['Tural Əliyev', 'm', 1496, true, false],
        ['Orxan Quliyev', 'm', 1463, false, false],
        ['Günel Hüseynova', 'f', 1441, false, true],
        ['Kənan Abbasov', 'm', 1412, false, false],
        ['Leyla Quliyeva', 'f', 1387, true, false],
        ['Nicat Vəliyev', 'm', 1361, false, false],
        ['Sevinc Abbasova', 'f', 1338, false, false],
        ['Ramil İsmayılov', 'm', 1316, false, false],
        ['Murad Cəfərov', 'm', 1284, false, false],
        ['Zərifə Vəliyeva', 'f', 1257, false, false],
        ['Anar Mahmudov', 'm', 1231, false, false],
        ['Nərmin İsmayılova', 'f', 1206, false, false],
        ['Fuad Rəhimov', 'm', 1187, false, false],
        ['Lalə Cəfərova', 'f', 1166, false, false],
        ['Emin Sultanov', 'm', 1122, false, false],
        ['Aytən Rəhimova', 'f', 1097, false, false],
        ['Vüsal Kərimov', 'm', 1061, false, false],
        ['Ülviyyə Sultanova', 'f', 1033, false, false],
        ['Samir Babayev', 'm', 1012, false, false],
        ['Cavid Hacıyev', 'm', 986, false, false],
        ['Fidan Kərimova', 'f', 961, false, false],
        ['Toğrul Nəbiyev', 'm', 942, false, false],
        ['Türkan Babayeva', 'f', 926, false, false],
        ['Elçin Yusifov', 'm', 915, false, false],
    ];

    private const TEAM_NAMES = [
        'Bakı Aslanları', 'Xəzər Dalğaları', 'Alov Qüllələri', 'Abşeron Padel', 'Qala Team',
        'Nizami Smashers', 'Dəniz Ulduzları', 'Şəhər Reketləri', 'Yaşıl Kort', 'Mərkəz Padel',
        'Günəş Komandası', 'Atəş Sportu',
    ];

    public function run(): void
    {
        $hash = app(PasswordService::class)->hash('DemoPadel#2026');
        $now = now();

        // ---- 1. Players + ratings -------------------------------------------
        $ids = [];   // index => user id
        foreach (self::PLAYERS as $i => [$name, $gender, $elo, $vip, $verified]) {
            $slug = $this->slug($name);
            $uid = $this->uuid("user-$slug");
            $ids[$i] = $uid;
            $portrait = $gender === 'm'
                ? 'https://randomuser.me/api/portraits/men/'.(($i % 70) + 5).'.jpg'
                : 'https://randomuser.me/api/portraits/women/'.(($i % 70) + 5).'.jpg';

            DB::table('users')->updateOrInsert(['id' => $uid], [
                'email' => "demo.$slug@linkfit.az",
                'password_hash' => $hash,
                'display_name' => $name,
                'username' => Str::limit($slug, 38, ''),
                'photo_url' => $portrait,
                'referral_code' => $this->refCode($slug),
                'is_vip' => $vip,
                'vip_badge_label' => $vip ? 'VIP' : null,
                'is_verified' => $verified,
                'is_ambassador' => in_array($i, [0, 3, 6, 11], true), // a few brand ambassadors

                'email_verified_at' => $now,
                'home_lat' => round(40.3850 + (($i * 37) % 100 - 50) / 1500, 6),
                'home_lng' => round(49.8400 + (($i * 53) % 100 - 50) / 1200, 6),
                'last_seen_at' => $now->copy()->subMinutes(($i * 17) % 600),
                'time_zone' => 'Asia/Baku',
                'updated_at' => $now,
                'created_at' => $now->copy()->subDays(40 - ($i % 30)),
            ]);

            $gp = max(6, (int) round(($elo - 840) / 12));
            $won = (int) round($gp * (0.40 + min(0.28, ($elo - 900) / 2200)));
            $rel = max(72, min(100, 100 - ($i % 6) * 4));
            DB::table('player_sport_stats')->updateOrInsert(
                ['user_id' => $uid, 'sport_id' => self::PADEL],
                ['elo_rating' => $elo, 'games_played' => $gp, 'games_won' => min($won, $gp), 'reliability_score' => $rel, 'updated_at' => $now],
            );
            // A subset also plays tennis so that ladder isn't empty.
            if ($i % 4 === 0) {
                DB::table('player_sport_stats')->updateOrInsert(
                    ['user_id' => $uid, 'sport_id' => self::TENNIS],
                    ['elo_rating' => 1100 + ($i * 23) % 360, 'games_played' => 4 + $i % 9, 'games_won' => 2 + $i % 5, 'reliability_score' => $rel, 'updated_at' => $now],
                );
            }
        }

        // ---- 2. Follows (a connected social graph) --------------------------
        $follows = [];
        $n = count($ids);
        foreach ($ids as $a => $uidA) {
            foreach ([1, 2, 3, 5, 8] as $step) {       // each follows a few others
                $b = ($a + $step) % $n;
                if ($a === $b) {
                    continue;
                }
                $follows[] = ['follower_user_id' => $uidA, 'followed_user_id' => $ids[$b], 'created_at' => $now->copy()->subDays(($a + $step) % 30)];
            }
        }
        foreach (array_chunk($follows, 200) as $chunk) {
            DB::table('follows')->insertOrIgnore($chunk);
        }

        // ---- 3. Venue reviews -----------------------------------------------
        $reviewBodies = [
            'Kortlar əla vəziyyətdədir, işıqlandırma çox yaxşıdır. Mütləq qayıdacağam!',
            'Heyət çox peşəkardır, rezervasiya rahatdır. Tövsiyə edirəm.',
            'Super məkan, dostlarla əyləncəli oyunlar üçün ideal.',
            'Təmiz, müasir və mərkəzi yerləşir. Padel üçün ən yaxşılarından biri.',
            'Atmosfer əla, qiymətlər münasibdir. 5 ulduz!',
        ];
        foreach (self::VENUES as $vi => $venue) {
            for ($k = 0; $k < 4; $k++) {
                $author = $ids[($vi * 5 + $k * 3) % $n];
                DB::table('venue_reviews')->updateOrInsert(
                    ['venue_id' => $venue['id'], 'author_user_id' => $author],
                    [
                        'id' => $this->uuid("review-$vi-$k"),
                        'rating' => 5 - ($k % 2),
                        'body' => $reviewBodies[($vi + $k) % count($reviewBodies)],
                        'created_at' => $now->copy()->subDays(($vi + $k) * 3 + 1),
                        'updated_at' => $now,
                    ],
                );
            }
        }

        // ---- 4. Upcoming games + participants -------------------------------
        $gameNotes = [
            'Dostluq oyunu, hər səviyyə xoş gəlib!', 'Rəqabətli matç — yaxşı səviyyə axtarıram.',
            'Axşam padel, 2 yer açıqdır.', 'Səhər matçı, gəlin başlayaq!',
            'Qarışıq cüt, əyləncəli oyun.', 'Həftəsonu turniri üçün hazırlıq.',
        ];
        for ($g = 0; $g < 16; $g++) {
            $venue = self::VENUES[$g % 5];
            $host = $ids[($g * 5) % $n];
            $gid = $this->uuid("game-$g");
            $capacity = 4;
            // Spread games across today..+5 days (~3/day) so the "today" and
            // "week" discover tabs are both populated.
            $startsAt = $now->copy()->addDays(intdiv($g, 3))->setTime(9 + ($g % 3) * 4, 0);
            $minElo = [0, 900, 1100, 1300][$g % 4];
            $full = $g % 3 === 0;

            DB::table('games')->updateOrInsert(['id' => $gid], [
                'sport_id' => self::PADEL,
                'court_id' => $venue['court'],
                'host_user_id' => $host,
                'lat' => $venue['lat'],
                'lng' => $venue['lng'],
                'starts_at' => $startsAt,
                'duration_minutes' => 90,
                'capacity' => $capacity,
                'skill_min_elo' => $minElo ?: null,
                'skill_max_elo' => $minElo ? $minElo + 400 : null,
                'visibility' => 'public',
                'status' => $full ? 'full' : 'open',
                'match_type' => $g % 2 ? 'competitive' : 'casual',
                'notes' => $gameNotes[$g % count($gameNotes)],
                'updated_at' => $now,
                'created_at' => $now->copy()->subDays($g % 5),
            ]);

            // Host + a few participants (fill to capacity when "full").
            $members = [$host];
            $fillTo = $full ? $capacity : 2 + ($g % 2);
            for ($p = 1; $p < $fillTo; $p++) {
                $members[] = $ids[($g * 5 + $p * 7) % $n];
            }
            foreach (array_unique($members) as $mi => $member) {
                DB::table('game_participants')->updateOrInsert(
                    ['game_id' => $gid, 'user_id' => $member],
                    ['status' => 'confirmed', 'joined_at' => $startsAt->copy()->subDays(2)->addMinutes($mi * 30), 'status_changed_at' => $now],
                );
            }
        }

        // ---- 5. Regular tournaments + entries -------------------------------
        $tournaments = [
            ['Bakı Payız Kuboku 2026', 0, 12, 14, 4000],
            ['Xəzər Padel Open', 2, 8, 21, 6000],
            ['Sea Breeze Americano Cup', 2, 16, 28, 5000],
            ['Qış Çempionatı', 1, 10, 35, 7500],
            ['Şəhər Liqası — Mərhələ 1', 3, 12, 10, 3000],
        ];
        foreach ($tournaments as $ti => [$name, $venueIdx, $maxSquads, $daysOut, $fee]) {
            $venue = self::VENUES[$venueIdx];
            $tid = $this->uuid("tournament-$ti");
            $startsAt = $now->copy()->addDays($daysOut)->setTime(10, 0);
            DB::table('tournaments')->updateOrInsert(['id' => $tid], [
                'name' => $name,
                'description' => 'LinkFit padel turniri — komandanı qur, qeydiyyatdan keç və mübarizəyə başla. Bütün səviyyələr üçün açıqdır.',
                'sport_id' => self::PADEL,
                'venue_id' => $venue['id'],
                'starts_at' => $startsAt,
                'ends_at' => $startsAt->copy()->addHours(8),
                'registration_deadline' => $startsAt->copy()->subDays(2),
                'max_squads' => $maxSquads,
                'squad_size' => 2,
                'entry_fee_minor' => $fee,
                'currency' => 'AZN',
                'status' => 'registration_open',
                'updated_at' => $now,
                'created_at' => $now->copy()->subDays(3),
            ]);

            $entryCount = min($maxSquads - 2, 6); // leave a couple of slots open
            for ($e = 0; $e < $entryCount; $e++) {
                $captainIdx = ($ti * 4 + $e * 2) % $n;
                $partnerIdx = ($captainIdx + 1) % $n;
                $captain = $ids[$captainIdx];
                $eid = $this->uuid("entry-$ti-$e");
                $exists = DB::table('tournament_entries')
                    ->where('tournament_id', $tid)->where('captain_user_id', $captain)->exists();
                if ($exists) {
                    continue;
                }
                DB::table('tournament_entries')->insert([
                    'id' => $eid,
                    'tournament_id' => $tid,
                    'captain_user_id' => $captain,
                    'squad_name' => self::TEAM_NAMES[($ti * 3 + $e) % count(self::TEAM_NAMES)],
                    'player_ids' => '{'.$captain.','.$ids[$partnerIdx].'}',
                    'status' => 'confirmed',
                    'created_at' => $now->copy()->subDays(2)->addHours($e),
                ]);
            }
        }

        // ---- 6. Americano tournaments + teams -------------------------------
        $americanos = [
            ['Cümə Axşamı Americano', 4, 'individual'],
            ['Həftəsonu Mixed Americano', 3, 'team'],
            ['Gecə Liqası Americano', 4, 'individual'],
        ];
        foreach ($americanos as $ai => [$name, $courtCount, $scoring]) {
            $host = $ids[$ai];
            $aid = $this->uuid("americano-$ai");
            DB::table('americano_tournaments')->updateOrInsert(['id' => $aid], [
                'name' => $name,
                'format' => 'americano',
                'host_id' => $host,
                'court_count' => $courtCount,
                'scoring_system' => $scoring,
                'status' => 'open',
                'created_at' => $now->copy()->subDays($ai + 1),
            ]);
            for ($tn = 0; $tn < 5; $tn++) {
                DB::table('americano_teams')->updateOrInsert(['id' => $this->uuid("ateam-$ai-$tn")], [
                    'tournament_id' => $aid,
                    'display_name' => self::TEAM_NAMES[($ai * 2 + $tn) % count(self::TEAM_NAMES)],
                    'wins' => 0, 'draws' => 0, 'losses' => 0, 'score' => 0,
                ]);
            }
        }

        $this->command?->info('Demo content seeded: '.count(self::PLAYERS).' players, 16 games, 5 tournaments, 3 americanos, venue reviews + follows.');
    }

    private function uuid(string $name): string
    {
        return Uuid::uuid5(Uuid::NAMESPACE_URL, 'linkfit-demo-'.$name)->toString();
    }

    private function slug(string $name): string
    {
        $map = ['ə' => 'a', 'ı' => 'i', 'ö' => 'o', 'ü' => 'u', 'ç' => 'c', 'ş' => 's', 'ğ' => 'g'];
        $ascii = strtr(mb_strtolower($name), $map);

        return trim(preg_replace('/[^a-z0-9]+/', '-', $ascii), '-');
    }

    private function refCode(string $slug): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $h = crc32($slug);
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= $alphabet[$h % 31];
            $h = intdiv($h, 31) + 7;
        }

        return $code;
    }
}
