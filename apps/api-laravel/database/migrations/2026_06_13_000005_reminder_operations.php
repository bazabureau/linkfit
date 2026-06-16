<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('booking_reminders_sent')) {
            Schema::create('booking_reminders_sent', function (Blueprint $table) {
                $table->uuid('booking_id');
                $table->uuid('user_id');
                $table->timestampTz('sent_at')->useCurrent();
                $table->primary(['booking_id', 'user_id']);
                $table->index(['user_id', 'sent_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_reminders_sent');
    }
};
