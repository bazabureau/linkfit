<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Financial integrity: a booking's refund can never exceed what was paid.
 * Enforced at the DB layer so it holds across every admin/partner refund,
 * update, cancel and bulk path (defense-in-depth alongside controller checks).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_refund_le_total');
        DB::statement('ALTER TABLE bookings ADD CONSTRAINT bookings_refund_le_total CHECK (refund_amount_minor IS NULL OR refund_amount_minor <= COALESCE(total_minor, 0))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_refund_le_total');
    }
};
