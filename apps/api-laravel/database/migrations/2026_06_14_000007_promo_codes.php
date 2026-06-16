<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('promo_codes')) {
            Schema::create('promo_codes', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('code', 64)->unique();
                $table->string('title', 120)->nullable();
                $table->text('description')->nullable();
                $table->string('discount_type', 24);
                $table->unsignedInteger('discount_value');
                $table->string('currency', 8)->default('AZN');
                $table->unsignedInteger('min_amount_minor')->default(0);
                $table->unsignedInteger('max_discount_minor')->nullable();
                $table->unsignedInteger('max_redemptions')->nullable();
                $table->unsignedSmallInteger('per_user_limit')->default(1);
                $table->timestampTz('starts_at')->nullable();
                $table->timestampTz('ends_at')->nullable();
                $table->string('status', 32)->default('active');
                $table->uuid('created_by_user_id')->nullable();
                $table->timestampsTz();
                $table->index(['status', 'starts_at', 'ends_at']);
            });
        }

        if (! Schema::hasTable('booking_promo_redemptions')) {
            Schema::create('booking_promo_redemptions', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('promo_code_id');
                $table->uuid('booking_id');
                $table->uuid('user_id');
                $table->unsignedInteger('discount_minor')->default(0);
                $table->timestampTz('created_at');
                $table->unique('booking_id');
                $table->index(['promo_code_id', 'created_at']);
                $table->index(['user_id', 'promo_code_id']);
            });
        }

        if (Schema::hasTable('bookings')) {
            Schema::table('bookings', function (Blueprint $table) {
                if (! Schema::hasColumn('bookings', 'subtotal_minor')) {
                    $table->unsignedInteger('subtotal_minor')->nullable();
                }
                if (! Schema::hasColumn('bookings', 'discount_minor')) {
                    $table->unsignedInteger('discount_minor')->default(0);
                }
                if (! Schema::hasColumn('bookings', 'promo_code_id')) {
                    $table->uuid('promo_code_id')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('bookings')) {
            Schema::table('bookings', function (Blueprint $table) {
                foreach (['promo_code_id', 'discount_minor', 'subtotal_minor'] as $column) {
                    if (Schema::hasColumn('bookings', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        Schema::dropIfExists('booking_promo_redemptions');
        Schema::dropIfExists('promo_codes');
    }
};
