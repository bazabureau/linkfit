<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('support_tickets')) {
            Schema::create('support_tickets', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->string('category', 40)->default('general');
                $table->string('subject', 160);
                $table->text('message');
                $table->string('status', 32)->default('open');
                $table->string('priority', 24)->default('normal');
                $table->string('related_kind', 40)->nullable();
                $table->uuid('related_id')->nullable();
                $table->uuid('assigned_to_user_id')->nullable();
                $table->text('resolution_note')->nullable();
                $table->timestampTz('resolved_at')->nullable();
                $table->timestampsTz();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->index(['user_id', 'created_at']);
                $table->index(['status', 'priority', 'created_at']);
                $table->index(['related_kind', 'related_id']);
            });
        }

        if (! Schema::hasTable('support_ticket_messages')) {
            Schema::create('support_ticket_messages', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('ticket_id');
                $table->uuid('author_user_id');
                $table->string('author_role', 24)->default('user');
                $table->text('body');
                $table->timestampsTz();
                $table->foreign('ticket_id')->references('id')->on('support_tickets')->cascadeOnDelete();
                $table->foreign('author_user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->index(['ticket_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('support_ticket_messages');
        Schema::dropIfExists('support_tickets');
    }
};
