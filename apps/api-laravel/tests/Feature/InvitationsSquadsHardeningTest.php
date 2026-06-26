<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\InvitationsController;
use App\Http\Controllers\Api\SquadsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Authorization + state-machine + anti-spam hardening for InvitationsController
 * and SquadsController. Mirrors GamesHardeningTest's sqlite-in-memory,
 * direct-controller pattern. We deliberately avoid the squad games() success
 * path (its selectRaw uses Postgres-only `::int` casts) and only exercise its
 * guard path; the invitation create/accept/decline success paths use plain SQL
 * joins that run fine on sqlite.
 */
class InvitationsSquadsHardeningTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';
    private const INVITEE = '00000000-0000-4000-8000-000000000002';
    private const OTHER = '00000000-0000-4000-8000-000000000003';
    private const OUTSIDER = '00000000-0000-4000-8000-000000000004';

    private InvitationsController $invites;

    private SquadsController $squads;

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
            $table->string('photo_url')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
        });

        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name')->nullable();
            $table->string('photo_url')->nullable();
        });

        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id')->default('sport-padel');
            $table->string('host_user_id');
            $table->string('court_id')->nullable();
            $table->integer('capacity')->default(4);
            $table->string('status')->default('open');
            $table->string('visibility')->default('public');
            $table->timestamp('starts_at')->nullable();
            $table->integer('duration_minutes')->default(90);
            $table->float('lat')->default(0);
            $table->float('lng')->default(0);
            $table->integer('skill_min_elo')->nullable();
            $table->integer('skill_max_elo')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->default('confirmed');
            $table->timestamp('joined_at')->nullable();
            $table->timestamp('status_changed_at')->nullable();
            $table->primary(['game_id', 'user_id']);
        });

        Schema::create('game_invitations', function ($table): void {
            $table->string('id')->primary();
            $table->string('game_id');
            $table->string('inviter_user_id');
            $table->string('invitee_user_id');
            $table->string('status')->default('pending');
            $table->timestamp('created_at')->nullable();
            $table->timestamp('responded_at')->nullable();
        });
        // Mirror the production partial unique index so insertOrIgnore is a no-op
        // when a pending invite for (game, invitee) already exists.
        DB::statement("CREATE UNIQUE INDEX game_invitations_pending_uq ON game_invitations (game_id, invitee_user_id) WHERE status = 'pending'");

        Schema::create('notifications', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->text('payload')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
            $table->primary(['blocker_user_id', 'blocked_user_id']);
        });

        Schema::create('squads', function ($table): void {
            $table->string('id')->primary();
            $table->string('owner_id');
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('photo_url')->nullable();
            $table->integer('max_size')->default(8);
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('squad_members', function ($table): void {
            $table->string('squad_id');
            $table->string('user_id');
            $table->string('role')->default('member');
            $table->string('status')->default('pending');
            $table->timestamp('joined_at')->nullable();
            $table->primary(['squad_id', 'user_id']);
        });

        DB::table('users')->insert([
            ['id' => self::HOST, 'display_name' => 'Host'],
            ['id' => self::INVITEE, 'display_name' => 'Invitee'],
            ['id' => self::OTHER, 'display_name' => 'Other'],
            ['id' => self::OUTSIDER, 'display_name' => 'Outsider'],
        ]);
        DB::table('sports')->insert(['id' => 'sport-padel', 'slug' => 'padel']);
        DB::table('games')->insert([
            'id' => 'game-one',
            'sport_id' => 'sport-padel',
            'host_user_id' => self::HOST,
            'capacity' => 4,
            'status' => 'open',
            'visibility' => 'public',
            'starts_at' => now()->addDay(),
            'duration_minutes' => 90,
        ]);
        DB::table('game_participants')->insert([
            'game_id' => 'game-one', 'user_id' => self::HOST, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now(),
        ]);

        $this->invites = app(InvitationsController::class);
        $this->squads = app(SquadsController::class);
    }

    protected function tearDown(): void
    {
        foreach (['squad_members', 'squads', 'user_blocks', 'notifications', 'game_invitations', 'game_participants', 'games', 'courts', 'venues', 'sports', 'users'] as $t) {
            Schema::dropIfExists($t);
        }

        parent::tearDown();
    }

    // ---- Invitations -------------------------------------------------------

    public function test_invite_requires_host(): void
    {
        $this->expectStatus(403, fn () => $this->invites->create(
            $this->requestFor(self::INVITEE, ['invitee_user_id' => self::OTHER]),
            'game-one',
        ));
        $this->assertSame(0, DB::table('game_invitations')->count());
    }

    public function test_invite_rejects_self(): void
    {
        $this->expectStatus(422, fn () => $this->invites->create(
            $this->requestFor(self::HOST, ['invitee_user_id' => self::HOST]),
            'game-one',
        ));
    }

    public function test_invite_rejects_blocked_user(): void
    {
        DB::table('user_blocks')->insert(['blocker_user_id' => self::INVITEE, 'blocked_user_id' => self::HOST]);

        $this->expectStatus(403, fn () => $this->invites->create(
            $this->requestFor(self::HOST, ['invitee_user_id' => self::INVITEE]),
            'game-one',
        ));
        $this->assertSame(0, DB::table('game_invitations')->count());
    }

    public function test_invite_missing_game_returns_404(): void
    {
        $this->expectStatus(404, fn () => $this->invites->create(
            $this->requestFor(self::HOST, ['invitee_user_id' => self::INVITEE]),
            'no-such-game',
        ));
    }

    public function test_invite_soft_deleted_game_returns_404(): void
    {
        DB::table('games')->where('id', 'game-one')->update(['deleted_at' => now()]);

        $this->expectStatus(404, fn () => $this->invites->create(
            $this->requestFor(self::HOST, ['invitee_user_id' => self::INVITEE]),
            'game-one',
        ));
        $this->assertSame(0, DB::table('game_invitations')->count());
        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_invite_happy_path_creates_pending_and_notifies_once(): void
    {
        $response = $this->invites->create(
            $this->requestFor(self::HOST, ['invitee_user_id' => self::INVITEE]),
            'game-one',
        );

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('game_invitations')->where('status', 'pending')->where('invitee_user_id', self::INVITEE)->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::INVITEE)->count());
    }

    public function test_reinvite_already_pending_does_not_double_notify(): void
    {
        DB::table('game_invitations')->insert([
            'id' => 'inv-1', 'game_id' => 'game-one', 'inviter_user_id' => self::HOST,
            'invitee_user_id' => self::INVITEE, 'status' => 'pending', 'created_at' => now(),
        ]);

        $response = $this->invites->create(
            $this->requestFor(self::HOST, ['invitee_user_id' => self::INVITEE]),
            'game-one',
        );

        // Contract preserved (still 201 + the existing pending invite) but the
        // no-op insert must NOT re-fire a push notification.
        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('game_invitations')->where('status', 'pending')->count());
        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_batch_requires_host(): void
    {
        $this->expectStatus(403, fn () => $this->invites->batch(
            $this->requestFor(self::INVITEE, ['user_ids' => [self::OTHER]]),
            'game-one',
        ));
    }

    public function test_batch_rejects_oversized_list(): void
    {
        $ids = [];
        for ($i = 0; $i < 51; $i++) {
            $ids[] = sprintf('00000000-0000-4000-8000-%012d', $i + 100);
        }
        $this->expectStatus(422, fn () => $this->invites->batch(
            $this->requestFor(self::HOST, ['user_ids' => $ids]),
            'game-one',
        ));
    }

    public function test_batch_skips_self_and_blocked(): void
    {
        DB::table('user_blocks')->insert(['blocker_user_id' => self::OTHER, 'blocked_user_id' => self::HOST]);

        $response = $this->invites->batch(
            $this->requestFor(self::HOST, ['user_ids' => [self::INVITEE, self::OTHER, self::HOST]]),
            'game-one',
        );

        $body = $response->getData(true);
        $this->assertSame(1, $body['sent']);
        $this->assertSame(2, $body['blocked']);
        $this->assertSame(1, DB::table('notifications')->count());
    }

    public function test_accept_rejects_non_invitee(): void
    {
        DB::table('game_invitations')->insert([
            'id' => 'inv-1', 'game_id' => 'game-one', 'inviter_user_id' => self::HOST,
            'invitee_user_id' => self::INVITEE, 'status' => 'pending', 'created_at' => now(),
        ]);

        $this->expectStatus(404, fn () => $this->invites->accept(
            $this->requestFor(self::OUTSIDER), 'inv-1',
        ));
        $this->assertSame('pending', DB::table('game_invitations')->where('id', 'inv-1')->value('status'));
    }

    public function test_accept_happy_path_confirms_participant(): void
    {
        DB::table('game_invitations')->insert([
            'id' => 'inv-1', 'game_id' => 'game-one', 'inviter_user_id' => self::HOST,
            'invitee_user_id' => self::INVITEE, 'status' => 'pending', 'created_at' => now(),
        ]);

        $response = $this->invites->accept($this->requestFor(self::INVITEE), 'inv-1');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('accepted', DB::table('game_invitations')->where('id', 'inv-1')->value('status'));
        $this->assertSame('confirmed', DB::table('game_participants')
            ->where('game_id', 'game-one')->where('user_id', self::INVITEE)->value('status'));
    }

    public function test_accept_rejects_when_game_full(): void
    {
        DB::table('games')->where('id', 'game-one')->update(['capacity' => 1]); // host already confirmed
        DB::table('game_invitations')->insert([
            'id' => 'inv-1', 'game_id' => 'game-one', 'inviter_user_id' => self::HOST,
            'invitee_user_id' => self::INVITEE, 'status' => 'pending', 'created_at' => now(),
        ]);

        $this->expectStatus(409, fn () => $this->invites->accept(
            $this->requestFor(self::INVITEE), 'inv-1',
        ));
        $this->assertSame('pending', DB::table('game_invitations')->where('id', 'inv-1')->value('status'));
    }

    public function test_decline_cannot_touch_another_users_invitation(): void
    {
        DB::table('game_invitations')->insert([
            'id' => 'inv-1', 'game_id' => 'game-one', 'inviter_user_id' => self::HOST,
            'invitee_user_id' => self::INVITEE, 'status' => 'pending', 'created_at' => now(),
        ]);

        $this->expectStatus(404, fn () => $this->invites->decline(
            $this->requestFor(self::OUTSIDER), 'inv-1',
        ));
        $this->assertSame('pending', DB::table('game_invitations')->where('id', 'inv-1')->value('status'));
    }

    public function test_decline_happy_path(): void
    {
        DB::table('game_invitations')->insert([
            'id' => 'inv-1', 'game_id' => 'game-one', 'inviter_user_id' => self::HOST,
            'invitee_user_id' => self::INVITEE, 'status' => 'pending', 'created_at' => now(),
        ]);

        $response = $this->invites->decline($this->requestFor(self::INVITEE), 'inv-1');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('declined', DB::table('game_invitations')->where('id', 'inv-1')->value('status'));
    }

    // ---- Squads ------------------------------------------------------------

    public function test_squad_store_creates_owner_membership(): void
    {
        $response = $this->squads->store($this->requestFor(self::HOST, [
            'name' => 'Squad A', 'max_size' => 4,
        ]));

        $this->assertSame(201, $response->getStatusCode());
        $body = $response->getData(true);
        $this->assertSame(self::HOST, $body['owner_user_id']);
        $this->assertSame(1, DB::table('squad_members')->where('user_id', self::HOST)->where('role', 'owner')->where('status', 'active')->count());
    }

    public function test_squad_update_requires_owner(): void
    {
        $this->seedSquad();
        $this->expectStatus(403, fn () => $this->squads->update(
            $this->requestFor(self::OUTSIDER, ['name' => 'Hacked']), 'squad-one',
        ));
        $this->assertSame('Squad One', DB::table('squads')->where('id', 'squad-one')->value('name'));
    }

    public function test_squad_invite_requires_owner(): void
    {
        $this->seedSquad();
        $this->expectStatus(403, fn () => $this->squads->invite(
            $this->requestFor(self::OUTSIDER, ['user_id' => self::OTHER]), 'squad-one',
        ));
        $this->assertSame(0, DB::table('squad_members')->where('user_id', self::OTHER)->count());
    }

    public function test_squad_invite_blocked_user_forbidden(): void
    {
        $this->seedSquad();
        DB::table('user_blocks')->insert(['blocker_user_id' => self::INVITEE, 'blocked_user_id' => self::HOST]);

        $this->expectStatus(403, fn () => $this->squads->invite(
            $this->requestFor(self::HOST, ['user_id' => self::INVITEE]), 'squad-one',
        ));
        $this->assertSame(0, DB::table('squad_members')->where('user_id', self::INVITEE)->count());
    }

    public function test_squad_invite_happy_path_adds_pending_and_notifies(): void
    {
        $this->seedSquad();
        $response = $this->squads->invite(
            $this->requestFor(self::HOST, ['user_id' => self::INVITEE]), 'squad-one',
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('pending', DB::table('squad_members')->where('squad_id', 'squad-one')->where('user_id', self::INVITEE)->value('status'));
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::INVITEE)->where('type', 'squad.invited')->count());
    }

    public function test_squad_invite_full_returns_409(): void
    {
        $this->seedSquad(2); // owner active = 1, plus one more fills it
        DB::table('squad_members')->insert(['squad_id' => 'squad-one', 'user_id' => self::OTHER, 'role' => 'member', 'status' => 'active', 'joined_at' => now()]);

        $this->expectStatus(409, fn () => $this->squads->invite(
            $this->requestFor(self::HOST, ['user_id' => self::INVITEE]), 'squad-one',
        ));
        $this->assertSame(0, DB::table('squad_members')->where('user_id', self::INVITEE)->count());
    }

    public function test_squad_invite_existing_member_is_silent_noop(): void
    {
        $this->seedSquad();
        DB::table('squad_members')->insert(['squad_id' => 'squad-one', 'user_id' => self::INVITEE, 'role' => 'member', 'status' => 'active', 'joined_at' => now()]);

        $response = $this->squads->invite(
            $this->requestFor(self::HOST, ['user_id' => self::INVITEE]), 'squad-one',
        );

        $this->assertSame(200, $response->getStatusCode());
        // Still active (not demoted to pending) and no notification fired.
        $this->assertSame('active', DB::table('squad_members')->where('squad_id', 'squad-one')->where('user_id', self::INVITEE)->value('status'));
        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_squad_accept_requires_pending_invite(): void
    {
        $this->seedSquad();
        // Outsider with no membership row.
        $this->expectStatus(404, fn () => $this->squads->accept(
            $this->requestFor(self::OUTSIDER), 'squad-one',
        ));
    }

    public function test_squad_accept_rejects_non_pending(): void
    {
        $this->seedSquad();
        DB::table('squad_members')->insert(['squad_id' => 'squad-one', 'user_id' => self::INVITEE, 'role' => 'member', 'status' => 'active', 'joined_at' => now()]);

        $this->expectStatus(409, fn () => $this->squads->accept(
            $this->requestFor(self::INVITEE), 'squad-one',
        ));
    }

    public function test_squad_accept_happy_path(): void
    {
        $this->seedSquad();
        DB::table('squad_members')->insert(['squad_id' => 'squad-one', 'user_id' => self::INVITEE, 'role' => 'member', 'status' => 'pending', 'joined_at' => now()]);

        $response = $this->squads->accept($this->requestFor(self::INVITEE), 'squad-one');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('active', DB::table('squad_members')->where('squad_id', 'squad-one')->where('user_id', self::INVITEE)->value('status'));
    }

    public function test_squad_owner_leave_transfers_ownership(): void
    {
        $this->seedSquad();
        DB::table('squad_members')->insert(['squad_id' => 'squad-one', 'user_id' => self::INVITEE, 'role' => 'member', 'status' => 'active', 'joined_at' => now()]);

        $response = $this->squads->leave($this->requestFor(self::HOST), 'squad-one');

        $this->assertSame(204, $response->getStatusCode());
        $this->assertNotNull(DB::table('squads')->where('id', 'squad-one')->first());
        $this->assertSame(self::INVITEE, DB::table('squads')->where('id', 'squad-one')->value('owner_id'));
        $this->assertSame('owner', DB::table('squad_members')->where('squad_id', 'squad-one')->where('user_id', self::INVITEE)->value('role'));
        $this->assertSame(0, DB::table('squad_members')->where('squad_id', 'squad-one')->where('user_id', self::HOST)->count());
    }

    public function test_squad_owner_leave_without_successor_deletes_squad(): void
    {
        $this->seedSquad();

        $response = $this->squads->leave($this->requestFor(self::HOST), 'squad-one');

        $this->assertSame(204, $response->getStatusCode());
        $this->assertNull(DB::table('squads')->where('id', 'squad-one')->first());
        $this->assertSame(0, DB::table('squad_members')->where('squad_id', 'squad-one')->count());
    }

    public function test_squad_destroy_requires_owner(): void
    {
        $this->seedSquad();
        DB::table('squad_members')->insert(['squad_id' => 'squad-one', 'user_id' => self::INVITEE, 'role' => 'member', 'status' => 'active', 'joined_at' => now()]);

        $this->expectStatus(403, fn () => $this->squads->destroy(
            $this->requestFor(self::INVITEE), 'squad-one',
        ));
        $this->assertNotNull(DB::table('squads')->where('id', 'squad-one')->first());
    }

    public function test_squad_show_route_requires_membership(): void
    {
        $this->seedSquad();
        $this->expectStatus(404, fn () => $this->squads->showRoute(
            $this->requestFor(self::OUTSIDER), 'squad-one',
        ));
    }

    public function test_squad_games_requires_active_member(): void
    {
        $this->seedSquad();
        $this->expectStatus(404, fn () => $this->squads->games(
            $this->requestFor(self::OUTSIDER), 'squad-one',
        ));
    }

    // ---- helpers -----------------------------------------------------------

    private function seedSquad(int $maxSize = 8): void
    {
        DB::table('squads')->insert([
            'id' => 'squad-one', 'owner_id' => self::HOST, 'name' => 'Squad One',
            'max_size' => $maxSize, 'created_at' => now(),
        ]);
        DB::table('squad_members')->insert([
            'squad_id' => 'squad-one', 'user_id' => self::HOST, 'role' => 'owner', 'status' => 'active', 'joined_at' => now(),
        ]);
    }

    private function expectStatus(int $status, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$status}.");
        } catch (ApiException $e) {
            $this->assertSame($status, $e->getStatusCode());
        }
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
