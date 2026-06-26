<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MedicalController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * MedicalController hardening:
 *  - show()/update() only ever touch the caller's own profile row;
 *  - update() normalizes blank input to NULL and the share flag to a strict
 *    boolean (no string-y value flips the host opt-in on);
 *  - gameSummary() is host-only (IDOR) and discloses PII strictly for
 *    confirmed participants who opted in;
 *  - signWaiver() 404s for an unknown tournament and is idempotent.
 */
class MedicalProfileHardeningTest extends TestCase
{
    private const OWNER = '00000000-0000-4000-8000-0000000000a1';

    private const HOST = '00000000-0000-4000-8000-0000000000b1';

    private const PLAYER_IN = '00000000-0000-4000-8000-0000000000c1';

    private const PLAYER_OUT = '00000000-0000-4000-8000-0000000000d1';

    private const GAME = '00000000-0000-4000-8000-0000000000e1';

    private const TOURNAMENT = '00000000-0000-4000-8000-0000000000f1';

    private MedicalController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('medical_profiles', function ($table): void {
            $table->string('user_id')->primary();
            $table->text('blood_type')->nullable();
            $table->text('allergies')->nullable();
            $table->text('conditions')->nullable();
            $table->text('medications')->nullable();
            $table->text('emergency_contact_name')->nullable();
            $table->text('emergency_contact_phone')->nullable();
            $table->boolean('share_medical_with_host')->default(false);
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('host_user_id');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->default('confirmed');
        });

        Schema::create('tournaments', function ($table): void {
            $table->string('id')->primary();
            $table->string('name')->nullable();
        });

        Schema::create('tournament_waivers', function ($table): void {
            $table->string('tournament_id');
            $table->string('user_id');
            $table->timestamp('signed_at')->nullable();
            $table->string('ip')->nullable();
            $table->string('user_agent')->nullable();
        });

        foreach ([self::OWNER, self::HOST, self::PLAYER_IN, self::PLAYER_OUT] as $i => $id) {
            DB::table('users')->insert([
                'id' => $id,
                'display_name' => 'User '.$i,
                'created_at' => now(),
            ]);
        }

        $this->controller = new MedicalController;
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('tournament_waivers');
        Schema::dropIfExists('tournaments');
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('medical_profiles');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function request(string $userId, string $method = 'GET', array $body = []): Request
    {
        $request = Request::create('/api/v1/test', $method, $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }

    public function test_show_returns_empty_defaults_when_no_profile_exists(): void
    {
        $payload = $this->controller->show($this->request(self::OWNER))->getData(true);

        $this->assertNull($payload['blood_type']);
        $this->assertNull($payload['allergies']);
        $this->assertFalse($payload['share_medical_with_host']);
        $this->assertNull($payload['updated_at']);
    }

    public function test_update_persists_only_caller_profile_and_blanks_normalize_to_null(): void
    {
        $payload = $this->controller->update($this->request(self::OWNER, 'PUT', [
            'blood_type' => 'O+',
            'allergies' => '  ',          // whitespace-only -> NULL
            'conditions' => 'asthma',
            'share_medical_with_host' => true,
        ]))->getData(true);

        $this->assertSame('O+', $payload['blood_type']);
        $this->assertNull($payload['allergies']);
        $this->assertSame('asthma', $payload['conditions']);
        $this->assertTrue($payload['share_medical_with_host']);

        // Exactly one row, owned by the caller — no foreign rows touched.
        $this->assertSame(1, DB::table('medical_profiles')->count());
        $this->assertSame(self::OWNER, DB::table('medical_profiles')->value('user_id'));
    }

    public function test_update_normalizes_share_flag_to_strict_boolean(): void
    {
        // Enable, then disable — the flag must round-trip exactly.
        $this->controller->update($this->request(self::OWNER, 'PUT', ['share_medical_with_host' => true]));
        $this->assertTrue(
            $this->controller->show($this->request(self::OWNER))->getData(true)['share_medical_with_host']
        );

        $this->controller->update($this->request(self::OWNER, 'PUT', ['share_medical_with_host' => false]));
        $this->assertFalse(
            $this->controller->show($this->request(self::OWNER))->getData(true)['share_medical_with_host']
        );
    }

    public function test_update_rejects_oversized_blood_type(): void
    {
        $this->expectException(ApiException::class);
        $this->controller->update($this->request(self::OWNER, 'PUT', [
            'blood_type' => str_repeat('X', 9), // max:8
        ]));
    }

    public function test_game_summary_is_host_only(): void
    {
        $this->seedGame();

        try {
            $this->controller->gameSummary($this->request(self::PLAYER_IN), self::GAME);
            $this->fail('Expected a non-host to be forbidden from the medical summary.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }
    }

    public function test_game_summary_unknown_game_is_not_found(): void
    {
        try {
            $this->controller->gameSummary($this->request(self::HOST), 'does-not-exist');
            $this->fail('Expected a 404 for an unknown game.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_game_summary_discloses_only_confirmed_opted_in_participants(): void
    {
        $this->seedGame();

        $items = $this->controller->gameSummary($this->request(self::HOST), self::GAME)->getData(true)['items'];

        // Only PLAYER_IN (confirmed + share=true) appears. PLAYER_OUT opted out;
        // a pending participant and a non-participant are excluded.
        $this->assertCount(1, $items);
        $this->assertSame(self::PLAYER_IN, $items[0]['user_id']);
        $this->assertSame('B-', $items[0]['blood_type']);
        $this->assertSame('+99', $items[0]['emergency_contact_phone']);
    }

    public function test_sign_waiver_unknown_tournament_is_not_found(): void
    {
        try {
            $this->controller->signWaiver($this->request(self::OWNER, 'POST'), 'nope');
            $this->fail('Expected a 404 for an unknown tournament.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_sign_waiver_is_idempotent_and_reports_prior_signature(): void
    {
        DB::table('tournaments')->insert(['id' => self::TOURNAMENT, 'name' => 'Open']);

        $first = $this->controller->signWaiver($this->request(self::OWNER, 'POST'), self::TOURNAMENT)->getData(true);
        $this->assertFalse($first['already_signed']);
        $this->assertSame(self::OWNER, $first['user_id']);

        $second = $this->controller->signWaiver($this->request(self::OWNER, 'POST'), self::TOURNAMENT)->getData(true);
        $this->assertTrue($second['already_signed']);

        // Idempotent: still a single waiver row for this (tournament, user).
        $this->assertSame(1, DB::table('tournament_waivers')
            ->where('tournament_id', self::TOURNAMENT)->where('user_id', self::OWNER)->count());
    }

    private function seedGame(): void
    {
        DB::table('games')->insert([
            'id' => self::GAME,
            'host_user_id' => self::HOST,
            'created_at' => now(),
        ]);

        // Confirmed + opted-in -> disclosed.
        DB::table('medical_profiles')->insert([
            'user_id' => self::PLAYER_IN,
            'blood_type' => 'B-',
            'allergies' => 'peanuts',
            'emergency_contact_phone' => '+99',
            'share_medical_with_host' => true,
            'updated_at' => now(),
        ]);
        DB::table('game_participants')->insert([
            'game_id' => self::GAME, 'user_id' => self::PLAYER_IN, 'status' => 'confirmed',
        ]);

        // Confirmed but opted OUT -> excluded.
        DB::table('medical_profiles')->insert([
            'user_id' => self::PLAYER_OUT,
            'blood_type' => 'A+',
            'share_medical_with_host' => false,
            'updated_at' => now(),
        ]);
        DB::table('game_participants')->insert([
            'game_id' => self::GAME, 'user_id' => self::PLAYER_OUT, 'status' => 'confirmed',
        ]);

        // Opted-in but only PENDING -> excluded.
        DB::table('medical_profiles')->insert([
            'user_id' => self::HOST,
            'blood_type' => 'O-',
            'share_medical_with_host' => true,
            'updated_at' => now(),
        ]);
        DB::table('game_participants')->insert([
            'game_id' => self::GAME, 'user_id' => self::HOST, 'status' => 'pending',
        ]);
    }
}
