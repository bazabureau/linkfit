<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bookings')) {
            return;
        }

        Schema::table('bookings', function (Blueprint $table) {
            if (! Schema::hasColumn('bookings', 'cancellation_reason')) {
                $table->text('cancellation_reason')->nullable();
            }
            if (! Schema::hasColumn('bookings', 'cancelled_by_user_id')) {
                $table->uuid('cancelled_by_user_id')->nullable();
            }
            if (! Schema::hasColumn('bookings', 'refund_status')) {
                $table->string('refund_status', 32)->nullable();
            }
            if (! Schema::hasColumn('bookings', 'refund_amount_minor')) {
                $table->unsignedInteger('refund_amount_minor')->nullable();
            }
            if (! Schema::hasColumn('bookings', 'refund_note')) {
                $table->text('refund_note')->nullable();
            }
            if (! Schema::hasColumn('bookings', 'refunded_at')) {
                $table->timestampTz('refunded_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('bookings')) {
            return;
        }

        Schema::table('bookings', function (Blueprint $table) {
            foreach (['refunded_at', 'refund_note', 'refund_amount_minor', 'refund_status', 'cancelled_by_user_id', 'cancellation_reason'] as $column) {
                if (Schema::hasColumn('bookings', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
