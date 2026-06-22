<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tournament waiver gate: a per-tournament flag that makes signing the medical
 * waiver a precondition for entering.
 *
 * Additive only — a boolean NOT NULL DEFAULT false column, so every existing
 * tournament keeps its current "no waiver required" behaviour and enter() is
 * unchanged until an organiser opts a tournament in. The hasColumn guard keeps
 * a re-run a no-op (Postgres prod + sqlite tests).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tournaments')) {
            return;
        }

        Schema::table('tournaments', function (Blueprint $table): void {
            if (! Schema::hasColumn('tournaments', 'requires_waiver')) {
                $table->boolean('requires_waiver')->default(false)->nullable(false);
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('tournaments')) {
            return;
        }

        Schema::table('tournaments', function (Blueprint $table): void {
            if (Schema::hasColumn('tournaments', 'requires_waiver')) {
                $table->dropColumn('requires_waiver');
            }
        });
    }
};
