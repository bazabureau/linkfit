<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * App Store demo data: one "super player" (rich padel stats + a following) plus a
 * handful of opponents, so the Profile / Home stats / Community / Leaderboard
 * screens look full and impressive in screenshots.
 *
 * Idempotent — re-running updates the same accounts (keyed by email). All demo
 * accounts use the `demo+...@linkfit.az` marker so they are easy to find/remove
 * later (and they survive the `demo.%@linkfit.az` DemoContentSeeder cleanup).
 *
 *   php artisan db:seed --class=SuperPlayerDemoSeeder --force
 *
 * Login for screenshots →  email: demo+aysel@linkfit.az   password: Demo1234!
 */
class SuperPlayerDemoSeeder extends Seeder
{
    private const PASSWORD = 'Demo1234!';

    public function run(): void
    {
        $padelId = DB::table('sports')->where('slug', 'padel')->value('id');
        if ($padelId === null) {
            $this->command?->warn('SuperPlayerDemoSeeder: padel sport not found — aborting.');

            return;
        }

        $hash = Hash::make(self::PASSWORD);

        // [email, name, username, elo, played, won, reliability]
        $players = [
            ['demo+aysel@linkfit.az',  'Aysel Məmmədova',  'ayselm',  1842, 96, 71, 99], // the super player
            ['demo+elvin@linkfit.az',  'Elvin Quliyev',    'elvinq',  1788, 81, 58, 96],
            ['demo+nigar@linkfit.az',  'Nigar Hüseynova',  'nigarh',  1735, 74, 49, 94],
            ['demo+rauf@linkfit.az',   'Rauf Əliyev',      'raufa',   1690, 67, 43, 92],
            ['demo+leyla@linkfit.az',  'Leyla Babayeva',   'leylab',  1648, 59, 36, 97],
            ['demo+kamran@linkfit.az', 'Kamran Vəliyev',   'kamranv', 1605, 52, 31, 90],
            ['demo+sabina@linkfit.az', 'Sabina İsmayılova','sabinai', 1571, 44, 25, 95],
        ];

        $ids = [];
        $now = now();
        foreach ($players as [$email, $name, $username, $elo, $played, $won, $rel]) {
            // Upsert the user by email (citext unique).
            $existing = DB::table('users')->where('email', $email)->first(['id']);
            $id = $existing->id ?? (string) Str::uuid();
            DB::table('users')->updateOrInsert(
                ['email' => $email],
                [
                    'id' => $id,
                    'display_name' => $name,
                    'username' => $username,
                    'password_hash' => $hash,
                    'photo_url' => null,
                    'home_lat' => 40.3777, // Baku
                    'home_lng' => 49.8920,
                    'deleted_at' => null,
                    'updated_at' => $now,
                ]
            );
            $id = DB::table('users')->where('email', $email)->value('id');
            $ids[$email] = $id;

            // Upsert padel stats (won <= played enforced by a CHECK constraint).
            DB::table('player_sport_stats')->updateOrInsert(
                ['user_id' => $id, 'sport_id' => $padelId],
                [
                    'elo_rating' => $elo,
                    'games_played' => $played,
                    'games_won' => min($won, $played),
                    'reliability_score' => $rel,
                    'last_recalc_at' => $now,
                    'updated_at' => $now,
                ]
            );
        }

        // Build a social graph: everyone follows the super player; the super
        // player follows the first four back. insertOrIgnore avoids PK clashes.
        $super = $ids['demo+aysel@linkfit.az'];
        $others = array_values(array_diff_key($ids, ['demo+aysel@linkfit.az' => true]));
        $follows = [];
        foreach ($others as $oid) {
            $follows[] = ['follower_user_id' => $oid, 'followed_user_id' => $super, 'created_at' => $now];
        }
        foreach (array_slice($others, 0, 4) as $oid) {
            $follows[] = ['follower_user_id' => $super, 'followed_user_id' => $oid, 'created_at' => $now];
        }
        DB::table('follows')->insertOrIgnore($follows);

        $this->command?->info(
            'SuperPlayerDemoSeeder done: '.count($players).' demo players (super = Aysel Məmmədova, '
            .'login demo+aysel@linkfit.az / '.self::PASSWORD.'), '.count($follows).' follow edges.'
        );
    }
}
