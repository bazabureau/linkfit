<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Covers the GDPR/Apple phase-2 hard purge: ops:purge-deleted-accounts
 * anonymizes the users row + deletes personal/sensitive child data for accounts
 * whose 30-day cancellation window has elapsed, and leaves everything else alone.
 */
class PurgeDeletedAccountsTest extends TestCase
{
    public const DUE_ID = '00000000-0000-4000-8000-0000000000d1';
    public const FUTURE_ID = '00000000-0000-4000-8000-0000000000f1';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('password_hash')->nullable();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->float('home_lat')->nullable();
            $table->float('home_lng')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('account_deletion_requests', function ($table): void {
            $table->string('user_id')->primary();
            $table->timestamp('requested_at')->nullable();
            $table->timestamp('hard_delete_at')->nullable();
            $table->string('status')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('completed_at')->nullable();
        });

        Schema::create('refresh_tokens', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
        });

        Schema::create('follows', function ($table): void {
            $table->string('follower_user_id');
            $table->string('followed_user_id');
        });

        Schema::create('medical_profiles', function ($table): void {
            $table->string('user_id')->primary();
            $table->string('conditions')->nullable();
        });
    }

    protected function tearDown(): void
    {
        foreach (['medical_profiles', 'follows', 'refresh_tokens', 'account_deletion_requests', 'users'] as $t) {
            Schema::dropIfExists($t);
        }

        parent::tearDown();
    }

    private function seedUser(string $id, string $email, string $hardDeleteAt): void
    {
        DB::table('users')->insert([
            'id' => $id,
            'email' => $email,
            'password_hash' => 'real-bcrypt-hash',
            'display_name' => 'Real Name',
            'photo_url' => 'https://cdn/p.jpg',
            'home_lat' => 40.4,
            'home_lng' => 49.8,
            'created_at' => now(),
            'updated_at' => now(),
            'deleted_at' => now(),
        ]);
        DB::table('account_deletion_requests')->insert([
            'user_id' => $id,
            'requested_at' => now(),
            'hard_delete_at' => $hardDeleteAt,
            'status' => 'scheduled',
        ]);
        DB::table('refresh_tokens')->insert(['id' => $id.'-tok', 'user_id' => $id]);
        DB::table('follows')->insert(['follower_user_id' => $id, 'followed_user_id' => 'someone-else']);
        DB::table('medical_profiles')->insert(['user_id' => $id, 'conditions' => 'asthma']);
    }

    public function test_purges_accounts_past_grace_window_and_spares_the_rest(): void
    {
        $this->seedUser(self::DUE_ID, 'due@example.com', now()->subDay()->toDateTimeString());
        $this->seedUser(self::FUTURE_ID, 'future@example.com', now()->addDays(20)->toDateTimeString());

        Artisan::call('ops:purge-deleted-accounts');

        // Due account: PII anonymized, personal/sensitive children gone, completed.
        $due = DB::table('users')->where('id', self::DUE_ID)->first();
        $this->assertSame('deleted-'.self::DUE_ID.'@deleted.invalid', $due->email);
        $this->assertSame('Deleted user', $due->display_name);
        $this->assertNull($due->photo_url);
        $this->assertNull($due->home_lat);
        $this->assertSame('account-deleted', $due->password_hash);
        $this->assertSame(0, DB::table('refresh_tokens')->where('user_id', self::DUE_ID)->count());
        $this->assertSame(0, DB::table('follows')->where('follower_user_id', self::DUE_ID)->count());
        $this->assertSame(0, DB::table('medical_profiles')->where('user_id', self::DUE_ID)->count());
        $this->assertSame(
            'completed',
            DB::table('account_deletion_requests')->where('user_id', self::DUE_ID)->value('status'),
        );

        // Future account (still inside the window): completely untouched.
        $future = DB::table('users')->where('id', self::FUTURE_ID)->first();
        $this->assertSame('future@example.com', $future->email);
        $this->assertSame('Real Name', $future->display_name);
        $this->assertSame(1, DB::table('refresh_tokens')->where('user_id', self::FUTURE_ID)->count());
        $this->assertSame(
            'scheduled',
            DB::table('account_deletion_requests')->where('user_id', self::FUTURE_ID)->value('status'),
        );
    }

    public function test_dry_run_changes_nothing(): void
    {
        $this->seedUser(self::DUE_ID, 'due@example.com', now()->subDay()->toDateTimeString());

        Artisan::call('ops:purge-deleted-accounts', ['--dry-run' => true]);

        $this->assertSame('due@example.com', DB::table('users')->where('id', self::DUE_ID)->value('email'));
        $this->assertSame(1, DB::table('refresh_tokens')->where('user_id', self::DUE_ID)->count());
        $this->assertSame(
            'scheduled',
            DB::table('account_deletion_requests')->where('user_id', self::DUE_ID)->value('status'),
        );
    }
}
