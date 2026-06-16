<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        DB::transaction(function (): void {
            DB::table('sports')->updateOrInsert(
                ['slug' => 'padel'],
                ['name' => 'Padel', 'min_players' => 2, 'max_players' => 6],
            );
            DB::table('sports')->updateOrInsert(
                ['slug' => 'tennis'],
                ['name' => 'Tennis', 'min_players' => 2, 'max_players' => 4],
            );

            $allowedSportIds = DB::table('sports')
                ->whereIn('slug', ['padel', 'tennis'])
                ->pluck('id')
                ->all();

            $disabledSportIds = DB::table('sports')
                ->whereNotIn('slug', ['padel', 'tennis'])
                ->pluck('id')
                ->all();

            if ($disabledSportIds === []) {
                $this->seedTennisCourts();

                return;
            }

            $disabledGameIds = DB::table('games')
                ->whereIn('sport_id', $disabledSportIds)
                ->pluck('id')
                ->all();
            $disabledTournamentIds = DB::table('tournaments')
                ->whereIn('sport_id', $disabledSportIds)
                ->pluck('id')
                ->all();
            $disabledCourtIds = DB::table('courts')
                ->whereIn('sport_id', $disabledSportIds)
                ->pluck('id')
                ->all();

            if ($disabledGameIds !== []) {
                DB::table('conversations')->whereIn('game_id', $disabledGameIds)->update(['game_id' => null]);
                DB::table('game_reminders_sent')->whereIn('game_id', $disabledGameIds)->delete();
                DB::table('game_invitations')->whereIn('game_id', $disabledGameIds)->delete();
                DB::table('match_scores')->whereIn('game_id', $disabledGameIds)->delete();
                DB::table('ratings')->whereIn('game_id', $disabledGameIds)->delete();
                DB::table('bookings')->whereIn('game_id', $disabledGameIds)->delete();
                DB::table('games')->whereIn('id', $disabledGameIds)->delete();
            }

            if ($disabledTournamentIds !== []) {
                DB::table('conversations')->whereIn('tournament_id', $disabledTournamentIds)->update(['tournament_id' => null]);
                DB::table('tournament_waivers')->whereIn('tournament_id', $disabledTournamentIds)->delete();
                DB::table('tournament_entry_payments')->whereIn('tournament_id', $disabledTournamentIds)->delete();
                DB::table('tournaments')->whereIn('id', $disabledTournamentIds)->delete();
            }

            if ($disabledCourtIds !== []) {
                DB::table('bookings')->whereIn('court_id', $disabledCourtIds)->delete();
                DB::table('game_series')->whereIn('court_id', $disabledCourtIds)->update(['court_id' => null]);
                DB::table('courts')->whereIn('id', $disabledCourtIds)->delete();
            }

            DB::table('game_series')->whereIn('sport_id', $disabledSportIds)->delete();
            DB::table('ratings')->whereIn('sport_id', $disabledSportIds)->delete();
            DB::table('player_sport_stats')->whereIn('sport_id', $disabledSportIds)->delete();
            DB::table('sports')->whereNotIn('id', $allowedSportIds)->delete();

            $this->seedTennisCourts();
        });
    }

    public function down(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        DB::table('courts')
            ->whereIn('name', ['Tennis Court 1'])
            ->whereIn('sport_id', DB::table('sports')->where('slug', 'tennis')->pluck('id')->all())
            ->delete();
        DB::table('sports')->where('slug', 'tennis')->delete();
    }

    private function seedTennisCourts(): void
    {
        $tennisId = DB::table('sports')->where('slug', 'tennis')->value('id');
        if ($tennisId === null) {
            return;
        }

        $prices = [
            'Baku Tennis Club' => 7000,
            'Baku Tennis Academy' => 7500,
        ];

        foreach ($prices as $venueName => $amount) {
            $venueId = DB::table('venues')->where('name', $venueName)->value('id');
            if ($venueId === null) {
                continue;
            }

            DB::table('courts')->updateOrInsert(
                ['venue_id' => $venueId, 'name' => 'Tennis Court 1'],
                [
                    'sport_id' => $tennisId,
                    'hourly_price_minor' => $amount,
                    'currency' => 'AZN',
                ],
            );
        }
    }
};
