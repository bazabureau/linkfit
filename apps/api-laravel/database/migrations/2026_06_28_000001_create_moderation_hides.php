<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Generic moderation "hide" ledger backing the Apple Guideline 1.2 24h
     * moderation flow. One row marks a piece of UGC (story, feed event/comment,
     * message, …) as hidden from public read paths — either automatically once a
     * brigade of distinct reporters crosses the configured threshold (auto=true)
     * or manually by an admin acting on a report (auto=false). "Active" means
     * cleared_at IS NULL; clearing restores visibility without losing history.
     *
     * Deliberately written with the Schema builder (no Postgres-only DDL) so it
     * runs identically on the production Postgres and the in-memory sqlite the
     * test suite uses. The "one active hide per target" invariant is enforced in
     * application code (ReportsController) rather than a partial unique index,
     * which sqlite cannot express.
     */
    public function up(): void
    {
        if (Schema::hasTable('moderation_hides')) {
            return;
        }

        Schema::create('moderation_hides', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('target_kind');
            // Polymorphic across stories/feed_events/feed_comments/messages/etc.,
            // so it is not FK-constrained; stored as a string to stay portable.
            $table->string('target_id');
            $table->timestampTz('hidden_at')->useCurrent();
            $table->string('reason')->nullable();
            $table->boolean('auto')->default(true);
            $table->integer('report_count')->default(0);
            $table->uuid('hidden_by_user_id')->nullable();
            $table->timestampTz('cleared_at')->nullable();
            $table->uuid('cleared_by_user_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['target_kind', 'target_id'], 'moderation_hides_target_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('moderation_hides');
    }
};
