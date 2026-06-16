<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('venues')) {
            Schema::table('venues', function (Blueprint $table) {
                if (! Schema::hasColumn('venues', 'status')) {
                    $table->string('status', 32)->default('published');
                }
                if (! Schema::hasColumn('venues', 'opening_hours')) {
                    $table->jsonb('opening_hours')->nullable();
                }
                if (! Schema::hasColumn('venues', 'booking_slot_minutes')) {
                    $table->unsignedSmallInteger('booking_slot_minutes')->default(30);
                }
                if (! Schema::hasColumn('venues', 'min_booking_minutes')) {
                    $table->unsignedSmallInteger('min_booking_minutes')->default(60);
                }
                if (! Schema::hasColumn('venues', 'max_booking_minutes')) {
                    $table->unsignedSmallInteger('max_booking_minutes')->default(120);
                }
                if (! Schema::hasColumn('venues', 'cancellation_window_minutes')) {
                    $table->unsignedSmallInteger('cancellation_window_minutes')->default(120);
                }
                if (! Schema::hasColumn('venues', 'approved_at')) {
                    $table->timestampTz('approved_at')->nullable();
                }
                if (! Schema::hasColumn('venues', 'approved_by_user_id')) {
                    $table->uuid('approved_by_user_id')->nullable();
                }
            });
        }

        if (Schema::hasTable('courts')) {
            Schema::table('courts', function (Blueprint $table) {
                if (! Schema::hasColumn('courts', 'status')) {
                    $table->string('status', 32)->default('active');
                }
                if (! Schema::hasColumn('courts', 'photo_url')) {
                    $table->text('photo_url')->nullable();
                }
                if (! Schema::hasColumn('courts', 'photo_urls')) {
                    $table->jsonb('photo_urls')->nullable();
                }
            });
        }

        if (Schema::hasTable('bookings')) {
            Schema::table('bookings', function (Blueprint $table) {
                if (! Schema::hasColumn('bookings', 'source')) {
                    $table->string('source', 32)->default('app');
                }
                if (! Schema::hasColumn('bookings', 'payment_method')) {
                    $table->string('payment_method', 32)->nullable();
                }
                if (! Schema::hasColumn('bookings', 'payment_note')) {
                    $table->text('payment_note')->nullable();
                }
                if (! Schema::hasColumn('bookings', 'customer_name')) {
                    $table->string('customer_name', 120)->nullable();
                }
                if (! Schema::hasColumn('bookings', 'customer_email')) {
                    $table->string('customer_email', 254)->nullable();
                }
                if (! Schema::hasColumn('bookings', 'created_by_user_id')) {
                    $table->uuid('created_by_user_id')->nullable();
                }
                if (! Schema::hasColumn('bookings', 'rescheduled_at')) {
                    $table->timestampTz('rescheduled_at')->nullable();
                }
                if (! Schema::hasColumn('bookings', 'no_show_at')) {
                    $table->timestampTz('no_show_at')->nullable();
                }
                if (! Schema::hasColumn('bookings', 'no_show_marked_by_user_id')) {
                    $table->uuid('no_show_marked_by_user_id')->nullable();
                }
            });
        }

        if (Schema::hasTable('users')) {
            Schema::table('users', function (Blueprint $table) {
                if (! Schema::hasColumn('users', 'suspended_at')) {
                    $table->timestampTz('suspended_at')->nullable();
                }
                if (! Schema::hasColumn('users', 'suspension_reason')) {
                    $table->text('suspension_reason')->nullable();
                }
                if (! Schema::hasColumn('users', 'suspended_by_user_id')) {
                    $table->uuid('suspended_by_user_id')->nullable();
                }
            });
        }

        if (! Schema::hasTable('court_blocks')) {
            Schema::create('court_blocks', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('court_id');
                $table->uuid('created_by_user_id')->nullable();
                $table->timestampTz('starts_at');
                $table->timestampTz('ends_at');
                $table->string('reason', 160)->nullable();
                $table->timestampsTz();
                $table->index(['court_id', 'starts_at']);
            });
        }

        if (! Schema::hasTable('media_assets')) {
            Schema::create('media_assets', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id')->nullable();
                $table->string('disk', 64);
                $table->string('path');
                $table->string('url');
                $table->string('mime', 120)->nullable();
                $table->unsignedBigInteger('size_bytes')->default(0);
                $table->unsignedInteger('width')->nullable();
                $table->unsignedInteger('height')->nullable();
                $table->string('purpose', 64)->nullable();
                $table->timestampTz('deleted_at')->nullable();
                $table->timestampsTz();
                $table->index(['user_id', 'created_at']);
                $table->index(['purpose', 'created_at']);
            });
        }

        if (! Schema::hasTable('push_notification_jobs')) {
            Schema::create('push_notification_jobs', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->string('type', 80);
                $table->string('title');
                $table->text('body');
                $table->jsonb('payload')->nullable();
                $table->string('status', 32)->default('pending');
                $table->timestampTz('available_at')->nullable();
                $table->timestampTz('sent_at')->nullable();
                $table->text('error')->nullable();
                $table->timestampsTz();
                $table->index(['status', 'available_at']);
                $table->index(['user_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('push_notification_jobs');
        Schema::dropIfExists('media_assets');
        Schema::dropIfExists('court_blocks');
    }
};
