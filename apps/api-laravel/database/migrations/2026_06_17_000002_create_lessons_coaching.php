<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * "Learn" domain (Playtomic parity): coaches, scheduled lessons/classes, and
 * lesson bookings (enrollments). Also adds Casual/Competitive match_type to games.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('coaches')) {
            Schema::create('coaches', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id')->nullable();          // optional link to a user account
                $table->uuid('venue_id')->nullable();         // club the coach belongs to
                $table->uuid('sport_id')->nullable();         // primary sport
                $table->string('display_name');
                $table->string('photo_url')->nullable();
                $table->text('bio')->nullable();
                $table->integer('hourly_rate_minor')->nullable();
                $table->string('currency', 3)->default('AZN');
                $table->decimal('rating', 3, 2)->nullable();
                $table->unsignedSmallInteger('years_experience')->nullable();
                $table->boolean('is_active')->default(true);
                $table->uuid('created_by')->nullable();
                $table->timestampsTz();
                $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
                $table->foreign('venue_id')->references('id')->on('venues')->nullOnDelete();
                $table->foreign('sport_id')->references('id')->on('sports')->nullOnDelete();
                $table->index(['venue_id', 'is_active']);
                $table->index('sport_id');
            });
        }

        if (! Schema::hasTable('lessons')) {
            Schema::create('lessons', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('coach_id');
                $table->uuid('venue_id')->nullable();
                $table->uuid('court_id')->nullable();
                $table->uuid('sport_id');
                $table->string('title');
                $table->text('description')->nullable();
                $table->string('kind', 16)->default('group');       // group | private
                $table->string('level_label')->nullable();
                $table->integer('level_min_elo')->nullable();
                $table->integer('level_max_elo')->nullable();
                $table->timestampTz('starts_at');
                $table->unsignedSmallInteger('duration_minutes');
                $table->unsignedSmallInteger('capacity')->default(1);
                $table->integer('price_minor')->nullable();
                $table->string('currency', 3)->default('AZN');
                $table->string('status', 32)->default('scheduled'); // scheduled | cancelled | completed
                $table->uuid('created_by')->nullable();
                $table->timestampsTz();
                $table->foreign('coach_id')->references('id')->on('coaches')->cascadeOnDelete();
                $table->foreign('venue_id')->references('id')->on('venues')->nullOnDelete();
                $table->foreign('court_id')->references('id')->on('courts')->nullOnDelete();
                $table->foreign('sport_id')->references('id')->on('sports')->cascadeOnDelete();
                $table->index(['venue_id', 'starts_at', 'status']);
                $table->index(['coach_id', 'starts_at']);
                $table->index(['sport_id', 'starts_at']);
            });
        }

        if (! Schema::hasTable('lesson_bookings')) {
            Schema::create('lesson_bookings', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('lesson_id');
                $table->uuid('user_id');
                $table->string('status', 32)->default('booked');    // booked | cancelled | attended | no_show
                $table->timestampsTz();
                $table->foreign('lesson_id')->references('id')->on('lessons')->cascadeOnDelete();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->unique(['lesson_id', 'user_id']);
                $table->index(['user_id', 'created_at']);
                $table->index(['lesson_id', 'status']);
            });
        }

        // Playtomic-style Casual / Competitive match type on open games.
        if (! Schema::hasColumn('games', 'match_type')) {
            Schema::table('games', function (Blueprint $table) {
                $table->string('match_type', 16)->default('casual');
            });
        }

        $this->seed();
    }

    /** Seed starter coaches + upcoming lessons for the first venue (idempotent). */
    private function seed(): void
    {
        if (DB::table('coaches')->exists()) {
            return;
        }
        $venue = DB::table('venues')->where('status', 'active')->orderBy('created_at')->first(['id'])
            ?? DB::table('venues')->orderBy('created_at')->first(['id']);
        $padel = DB::table('sports')->where('slug', 'padel')->value('id');
        if ($venue === null || $padel === null) {
            return;
        }
        $court = DB::table('courts')->where('venue_id', $venue->id)->value('id');

        $coaches = [
            ['name' => 'Elvin Məmmədov', 'bio' => 'PTR sertifikatlı padel məşqçisi. 8 il təcrübə — başlanğıc və orta səviyyə.', 'rate' => 4000, 'exp' => 8, 'rating' => 4.9],
            ['name' => 'Nigar Əliyeva', 'bio' => 'Keçmiş tennis oyunçusu, indi padel məşqçisi. Texnika və oyun strategiyası.', 'rate' => 4500, 'exp' => 6, 'rating' => 4.8],
        ];
        $coachIds = [];
        foreach ($coaches as $c) {
            $cid = (string) Str::uuid();
            DB::table('coaches')->insert([
                'id' => $cid,
                'venue_id' => $venue->id,
                'sport_id' => $padel,
                'display_name' => $c['name'],
                'bio' => $c['bio'],
                'hourly_rate_minor' => $c['rate'],
                'currency' => 'AZN',
                'rating' => $c['rating'],
                'years_experience' => $c['exp'],
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $coachIds[] = $cid;
        }

        $lessons = [
            ['coach' => 0, 'title' => 'Başlanğıclar üçün padel', 'kind' => 'group', 'level' => 'Başlanğıc', 'when' => '+1 day 18:00', 'dur' => 60, 'cap' => 6, 'price' => 1500],
            ['coach' => 0, 'title' => 'Servis və voley təlimi', 'kind' => 'group', 'level' => 'Orta', 'when' => '+2 days 19:00', 'dur' => 90, 'cap' => 4, 'price' => 2000],
            ['coach' => 1, 'title' => 'Fərdi dərs', 'kind' => 'private', 'level' => 'Hər səviyyə', 'when' => '+3 days 17:00', 'dur' => 60, 'cap' => 1, 'price' => 4500],
        ];
        foreach ($lessons as $l) {
            DB::table('lessons')->insert([
                'id' => (string) Str::uuid(),
                'coach_id' => $coachIds[$l['coach']],
                'venue_id' => $venue->id,
                'court_id' => $court,
                'sport_id' => $padel,
                'title' => $l['title'],
                'kind' => $l['kind'],
                'level_label' => $l['level'],
                'starts_at' => date('Y-m-d H:i:sP', strtotime($l['when'])),
                'duration_minutes' => $l['dur'],
                'capacity' => $l['cap'],
                'price_minor' => $l['price'],
                'currency' => 'AZN',
                'status' => 'scheduled',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('lesson_bookings');
        Schema::dropIfExists('lessons');
        Schema::dropIfExists('coaches');
        if (Schema::hasColumn('games', 'match_type')) {
            Schema::table('games', function (Blueprint $table) {
                $table->dropColumn('match_type');
            });
        }
    }
};
