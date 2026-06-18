<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'username')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('username', 40)->nullable();
            });
        }

        // Admin-controlled "verified / official" badge (distinct from email verification).
        if (! Schema::hasColumn('users', 'is_verified')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('is_verified')->default(false);
            });
        }

        // Backfill a unique, URL-safe handle from each user's display_name.
        $taken = [];
        $rows = DB::table('users')->whereNull('username')->orderBy('created_at')->get(['id', 'display_name']);
        foreach ($rows as $u) {
            $base = Str::slug((string) ($u->display_name ?? ''));
            if ($base === '') {
                $base = 'player';
            }
            $base = substr($base, 0, 30);
            $slug = $base;
            $i = 1;
            while (isset($taken[$slug]) || DB::table('users')->where('username', $slug)->exists()) {
                $i++;
                $slug = $base.'-'.$i;
            }
            $taken[$slug] = true;
            DB::table('users')->where('id', $u->id)->update(['username' => $slug]);
        }

        Schema::table('users', function (Blueprint $table) {
            $table->unique('username');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['username']);
            $table->dropColumn('username');
        });
    }
};
