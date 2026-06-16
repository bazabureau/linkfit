<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('push_notification_jobs')) {
            Schema::table('push_notification_jobs', function (Blueprint $table) {
                if (! Schema::hasColumn('push_notification_jobs', 'attempts')) {
                    $table->unsignedSmallInteger('attempts')->default(0);
                }
                if (! Schema::hasColumn('push_notification_jobs', 'last_attempt_at')) {
                    $table->timestampTz('last_attempt_at')->nullable();
                }
                if (! Schema::hasColumn('push_notification_jobs', 'provider_response')) {
                    $table->jsonb('provider_response')->nullable();
                }
            });
        }

        if (Schema::hasTable('media_assets')) {
            Schema::table('media_assets', function (Blueprint $table) {
                if (! Schema::hasColumn('media_assets', 'cleanup_reason')) {
                    $table->string('cleanup_reason', 120)->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('push_notification_jobs')) {
            Schema::table('push_notification_jobs', function (Blueprint $table) {
                $table->dropColumn(['attempts', 'last_attempt_at', 'provider_response']);
            });
        }

        if (Schema::hasTable('media_assets')) {
            Schema::table('media_assets', function (Blueprint $table) {
                $table->dropColumn(['cleanup_reason']);
            });
        }
    }
};
