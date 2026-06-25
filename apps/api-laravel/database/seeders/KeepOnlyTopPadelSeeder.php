<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Launch venue cleanup: surface ONLY the partner venue (Top Padel Club Baku)
 * and hide every other (seed) venue from all public surfaces.
 *
 * REVERSIBLE & non-destructive — it only flips venues.status, a string column the
 * catalog filters on (visible = null|'published'; hidden = anything else). No
 * rows are deleted, so nothing cascades (courts/bookings stay intact) and any
 * hidden venue can be restored later by setting its status back to 'published'.
 *
 *   php artisan db:seed --class=KeepOnlyTopPadelSeeder --force
 */
class KeepOnlyTopPadelSeeder extends Seeder
{
    /** Match the partner venue tolerantly — the seeded name is 'Top Padel Club Baku'. */
    private const PARTNER_LIKE = '%top padel%';

    public function run(): void
    {
        $now = now();

        // Safety: never hide ALL venues. If no partner venue is found, abort —
        // otherwise the catalog would end up empty.
        $partnerCount = DB::table('venues')
            ->whereRaw('LOWER(name) LIKE ?', [self::PARTNER_LIKE])
            ->count();
        if ($partnerCount === 0) {
            $this->command?->warn(
                'KeepOnlyTopPadelSeeder: no venue matching "Top Padel" found — aborting so it cannot hide every venue. '
                .'Create/rename the partner venue first, then re-run.'
            );

            return;
        }

        // Ensure the partner venue is published + flagged as the partner.
        $partner = DB::table('venues')
            ->whereRaw('LOWER(name) LIKE ?', [self::PARTNER_LIKE])
            ->update(['status' => 'published', 'is_partner' => true, 'updated_at' => $now]);

        // Hide every other (seed) venue from the catalog.
        $hidden = DB::table('venues')
            ->whereRaw('LOWER(name) NOT LIKE ?', [self::PARTNER_LIKE])
            ->update(['status' => 'archived', 'updated_at' => $now]);

        $this->command?->info(
            "Venue cleanup done: {$partner} partner venue(s) published, {$hidden} other venue(s) hidden (status=archived, reversible)."
        );
    }
}
