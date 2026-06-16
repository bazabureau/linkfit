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
            $academy = DB::table('venues')->where('name', 'Baku Tennis Academy')->first(['id']);
            $typoAcademy = DB::table('venues')->where('name', 'Baku Tennis Academya')->first(['id']);

            if ($academy === null && $typoAcademy !== null) {
                DB::table('venues')
                    ->where('id', $typoAcademy->id)
                    ->update(['name' => 'Baku Tennis Academy']);
                $academyId = $typoAcademy->id;
            } else {
                $academyId = $academy->id ?? $typoAcademy->id ?? null;
            }

            $tennisId = DB::table('sports')->where('slug', 'tennis')->value('id');
            if ($academyId === null || $tennisId === null) {
                return;
            }

            DB::table('courts')->updateOrInsert(
                ['venue_id' => $academyId, 'name' => 'Tennis Court 1'],
                [
                    'sport_id' => $tennisId,
                    'hourly_price_minor' => 7500,
                    'currency' => 'AZN',
                ],
            );
        });
    }

    public function down(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        $tennisId = DB::table('sports')->where('slug', 'tennis')->value('id');
        if ($tennisId === null) {
            return;
        }

        DB::table('courts')
            ->where('name', 'Tennis Court 1')
            ->where('sport_id', $tennisId)
            ->whereIn('venue_id', DB::table('venues')->where('name', 'Baku Tennis Academy')->pluck('id')->all())
            ->delete();
    }
};
