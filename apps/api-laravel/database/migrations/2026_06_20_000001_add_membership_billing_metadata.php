<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('memberships')) {
            return;
        }

        Schema::table('memberships', function (Blueprint $table): void {
            if (! Schema::hasColumn('memberships', 'payment_provider')) {
                $table->string('payment_provider', 40)->nullable();
            }
            if (! Schema::hasColumn('memberships', 'provider_customer_id')) {
                $table->string('provider_customer_id', 160)->nullable();
            }
            if (! Schema::hasColumn('memberships', 'provider_subscription_id')) {
                $table->string('provider_subscription_id', 160)->nullable();
            }
            if (! Schema::hasColumn('memberships', 'subscription_status')) {
                $table->string('subscription_status', 40)->nullable();
            }
            if (! Schema::hasColumn('memberships', 'trial_ends_at')) {
                $table->timestampTz('trial_ends_at')->nullable();
            }
            if (! Schema::hasColumn('memberships', 'subscribed_at')) {
                $table->timestampTz('subscribed_at')->nullable();
            }
        });

        DB::statement('CREATE INDEX IF NOT EXISTS memberships_provider_customer_idx ON memberships (provider_customer_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS memberships_provider_subscription_idx ON memberships (provider_subscription_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS memberships_subscription_status_idx ON memberships (subscription_status)');
    }

    public function down(): void
    {
        if (! Schema::hasTable('memberships')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS memberships_provider_customer_idx');
        DB::statement('DROP INDEX IF EXISTS memberships_provider_subscription_idx');
        DB::statement('DROP INDEX IF EXISTS memberships_subscription_status_idx');

        Schema::table('memberships', function (Blueprint $table): void {
            $table->dropColumn([
                'payment_provider',
                'provider_customer_id',
                'provider_subscription_id',
                'subscription_status',
                'trial_ends_at',
                'subscribed_at',
            ]);
        });
    }
};
