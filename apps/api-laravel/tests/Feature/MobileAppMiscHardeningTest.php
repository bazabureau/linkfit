<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Covers the mobile/app/misc config + bootstrap surface owned by
 * MobileController, AppInfoController and MiscController: availability checks,
 * deep-link resolution (incl. the non-uuid/Postgres-cast guard), analytics
 * ingestion validation + source hardening, the app/version contract shape and
 * the bootstrap auth requirement.
 */
class MobileAppMiscHardeningTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->string('username')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
        });

        Schema::create('launch_analytics_events', function ($table): void {
            $table->string('id')->primary();
            $table->string('event', 160);
            $table->string('distinct_id', 120)->nullable();
            $table->string('user_id')->nullable();
            $table->json('properties')->nullable();
            $table->string('source', 40)->nullable();
            $table->string('ip_hash', 80)->nullable();
            $table->timestamp('occurred_at');
            $table->timestamp('created_at')->nullable();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('launch_analytics_events');
        Schema::dropIfExists('games');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function seedUser(string $email, string $username): void
    {
        DB::table('users')->insert([
            'id' => (string) Str::uuid(),
            'email' => $email,
            'username' => $username,
            'created_at' => now(),
        ]);
    }

    // ---- auth/check -------------------------------------------------------

    public function test_auth_check_reports_email_and_username_as_available_when_unused(): void
    {
        $this->getJson('/api/v1/auth/check?email=new@example.com&username=freshuser')
            ->assertOk()
            ->assertJsonPath('email.value', 'new@example.com')
            ->assertJsonPath('email.available', true)
            ->assertJsonPath('username.value', 'freshuser')
            ->assertJsonPath('username.valid', true)
            ->assertJsonPath('username.available', true);
    }

    public function test_auth_check_flags_taken_email_and_username_case_insensitively(): void
    {
        $this->seedUser('taken@example.com', 'takenuser');

        $this->getJson('/api/v1/auth/check?email=TAKEN@example.com&username=TakenUser')
            ->assertOk()
            ->assertJsonPath('email.available', false)
            ->assertJsonPath('username.available', false);
    }

    public function test_auth_check_rejects_invalid_username_format_without_a_lookup(): void
    {
        $this->getJson('/api/v1/auth/check?username=ab')
            ->assertOk()
            ->assertJsonPath('email', null)
            ->assertJsonPath('username.valid', false)
            ->assertJsonPath('username.available', false);
    }

    // ---- links/resolve ----------------------------------------------------

    public function test_resolve_link_handles_home_referral_and_unknown_targets(): void
    {
        $this->getJson('/api/v1/links/resolve?url='.urlencode('https://linkfit.az/'))
            ->assertOk()
            ->assertJsonPath('type', 'home')
            ->assertJsonPath('screen', 'home');

        // Locale prefix is stripped, ref code uppercased.
        $this->getJson('/api/v1/links/resolve?url='.urlencode('https://linkfit.az/az/r/abc123'))
            ->assertOk()
            ->assertJsonPath('type', 'referral')
            ->assertJsonPath('screen', 'register')
            ->assertJsonPath('params.ref', 'ABC123');

        $this->getJson('/api/v1/links/resolve?url='.urlencode('https://linkfit.az/something/else'))
            ->assertOk()
            ->assertJsonPath('type', 'unknown')
            ->assertJsonPath('params.path', 'something/else');
    }

    public function test_resolve_link_probes_existence_and_never_500s_on_a_non_uuid_id(): void
    {
        $gameId = '11111111-1111-4111-8111-111111111111';
        DB::table('games')->insert(['id' => $gameId]);

        $this->getJson('/api/v1/links/resolve?url='.urlencode('https://linkfit.az/games/'.$gameId))
            ->assertOk()
            ->assertJsonPath('type', 'game')
            ->assertJsonPath('exists', true)
            ->assertJsonPath('params.id', $gameId);

        // Malformed (non-uuid) id must be treated as "not found", not crash the
        // Postgres uuid cast — the controller short-circuits before querying.
        $this->getJson('/api/v1/links/resolve?url='.urlencode('https://linkfit.az/games/not-a-uuid'))
            ->assertOk()
            ->assertJsonPath('type', 'game')
            ->assertJsonPath('exists', false);

        $this->getJson('/api/v1/links/resolve?url='.urlencode('https://linkfit.az/games/22222222-2222-4222-8222-222222222222'))
            ->assertOk()
            ->assertJsonPath('exists', false);
    }

    // ---- analytics/events -------------------------------------------------

    public function test_analytics_requires_an_events_array(): void
    {
        $this->postJson('/api/v1/analytics/events', [])->assertStatus(422);
    }

    public function test_analytics_rejects_more_than_one_hundred_events(): void
    {
        $events = array_fill(0, 101, ['event' => 'launch.spam']);

        $this->postJson('/api/v1/analytics/events', ['events' => $events])
            ->assertStatus(422);
    }

    public function test_analytics_caps_overlong_source_to_the_column_width(): void
    {
        $this->postJson('/api/v1/analytics/events', [
            'events' => [[
                'event' => 'launch.long_source',
                'properties' => ['source' => str_repeat('a', 200)],
            ]],
        ])->assertAccepted()->assertJsonPath('accepted', 1);

        $row = DB::table('launch_analytics_events')->where('event', 'launch.long_source')->first();
        $this->assertNotNull($row);
        $this->assertSame(40, mb_strlen((string) $row->source));
    }

    public function test_analytics_falls_back_to_default_source_for_non_scalar_values(): void
    {
        $this->postJson('/api/v1/analytics/events', [
            'events' => [[
                'event' => 'launch.array_source',
                'properties' => ['source' => ['nested' => 1]],
            ]],
        ])->assertAccepted();

        $row = DB::table('launch_analytics_events')->where('event', 'launch.array_source')->first();
        $this->assertNotNull($row);
        $this->assertSame('web', $row->source);
    }

    // ---- app/version & bootstrap -----------------------------------------

    public function test_app_version_exposes_the_ios_block_contract(): void
    {
        $this->getJson('/api/v1/app/version')
            ->assertOk()
            ->assertJsonStructure([
                'ios' => [
                    'latest_build',
                    'latest_version',
                    'min_supported_build',
                    'force_update',
                    'release_notes_url',
                ],
                'minimum_supported_version',
                'latest_version',
                'force_update',
            ]);
    }

    public function test_mobile_bootstrap_requires_authentication(): void
    {
        $this->getJson('/api/v1/mobile/bootstrap')->assertStatus(401);
    }
}
