<?php

namespace Tests\Feature;

use Firebase\JWT\JWT;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class SocialPrivacyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('auth_tokens.access_secret', 'test-access-secret-with-more-than-32-characters');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('password_hash')->nullable();
            $table->string('username')->nullable();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->decimal('home_lat', 9, 6)->nullable();
            $table->decimal('home_lng', 9, 6)->nullable();
            $table->string('admin_role')->nullable();
            $table->boolean('is_vip')->default(false);
            $table->timestamp('vip_expires_at')->nullable();
            $table->string('vip_badge_label')->nullable();
            $table->boolean('is_verified')->default(false);
            $table->boolean('is_ambassador')->default(false);
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug')->unique();
            $table->string('name');
        });

        Schema::create('player_sport_stats', function ($table): void {
            $table->string('user_id');
            $table->string('sport_id');
            $table->integer('elo_rating')->nullable();
            $table->integer('games_played')->default(0);
            $table->integer('games_won')->default(0);
            $table->integer('reliability_score')->nullable();
        });

        Schema::create('follows', function ($table): void {
            $table->string('follower_user_id');
            $table->string('followed_user_id');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
            $table->timestamp('created_at')->nullable();
        });

        DB::table('sports')->insert(['id' => 'sport-padel', 'slug' => 'padel', 'name' => 'Padel']);
        $this->insertUser('019edbc3-a5fb-7123-9e6f-cc5d6d897393', 'hisrosie', 'Public Player');
        $this->insertUser('11111111-1111-4111-8111-111111111111', 'private-player', 'Private Player');
        $this->insertUser('22222222-2222-4222-8222-222222222222', 'viewer', 'Viewer');
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('follows');
        Schema::dropIfExists('player_sport_stats');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_anonymous_user_cannot_fetch_non_directory_profile(): void
    {
        $this->getJson('/api/v1/users/11111111-1111-4111-8111-111111111111/profile')
            ->assertNotFound()
            ->assertJsonPath('error.code', 'NOT_FOUND');
    }

    public function test_anonymous_user_can_fetch_public_directory_profile(): void
    {
        $this->getJson('/api/v1/users/hisrosie/profile')
            ->assertOk()
            ->assertJsonPath('id', '019edbc3-a5fb-7123-9e6f-cc5d6d897393')
            ->assertJsonMissingPath('email')
            ->assertJsonMissingPath('home_lat');
    }

    public function test_authenticated_user_can_fetch_non_directory_profile(): void
    {
        $this->getJson('/api/v1/users/11111111-1111-4111-8111-111111111111/profile', [
            'Authorization' => 'Bearer '.$this->accessToken('22222222-2222-4222-8222-222222222222'),
        ])
            ->assertOk()
            ->assertJsonPath('id', '11111111-1111-4111-8111-111111111111')
            ->assertJsonMissingPath('email')
            ->assertJsonMissingPath('home_lat');
    }

    public function test_anonymous_user_cannot_fetch_non_directory_social_graph(): void
    {
        $this->getJson('/api/v1/users/11111111-1111-4111-8111-111111111111/followers')
            ->assertNotFound()
            ->assertJsonPath('error.code', 'NOT_FOUND');
    }

    private function insertUser(string $id, string $username, string $displayName): void
    {
        DB::table('users')->insert([
            'id' => $id,
            'email' => $username.'@example.test',
            'password_hash' => 'x',
            'username' => $username,
            'display_name' => $displayName,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('player_sport_stats')->insert([
            'user_id' => $id,
            'sport_id' => 'sport-padel',
            'elo_rating' => 1000,
            'games_played' => 1,
            'games_won' => 1,
            'reliability_score' => 100,
        ]);
    }

    private function accessToken(string $userId): string
    {
        $now = time();

        return JWT::encode([
            'sub' => $userId,
            'sid' => 'test-session',
            'iat' => $now,
            'exp' => $now + 900,
        ], (string) config('auth_tokens.access_secret'), 'HS256');
    }
}
