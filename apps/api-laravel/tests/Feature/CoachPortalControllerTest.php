<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminLessonsController;
use App\Http\Controllers\Api\CoachPortalController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CoachPortalControllerTest extends TestCase
{
    private const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
    private const PLAYER_ID = '00000000-0000-4000-8000-000000000002';
    private const VENUE_ID = '00000000-0000-4000-8000-000000000010';
    private const COURT_ID = '00000000-0000-4000-8000-000000000011';
    private const SPORT_ID = '00000000-0000-4000-8000-000000000020';

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
            $table->string('display_name');
            $table->string('admin_role')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('sport_id')->nullable();
            $table->string('name');
            $table->string('status')->nullable();
        });
        Schema::create('coaches', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id')->nullable();
            $table->string('venue_id')->nullable();
            $table->string('sport_id')->nullable();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->text('bio')->nullable();
            $table->integer('hourly_rate_minor')->nullable();
            $table->string('currency')->nullable();
            $table->float('rating')->nullable();
            $table->integer('years_experience')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('created_by')->nullable();
            $table->timestamps();
        });
        Schema::create('lessons', function ($table): void {
            $table->string('id')->primary();
            $table->string('coach_id');
            $table->string('venue_id')->nullable();
            $table->string('court_id')->nullable();
            $table->string('sport_id');
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('kind');
            $table->string('level_label')->nullable();
            $table->integer('level_min_elo')->nullable();
            $table->integer('level_max_elo')->nullable();
            $table->dateTime('starts_at');
            $table->integer('duration_minutes');
            $table->integer('capacity');
            $table->integer('price_minor')->nullable();
            $table->string('currency')->nullable();
            $table->string('status');
            $table->string('created_by')->nullable();
            $table->timestamps();
        });
        Schema::create('lesson_bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('lesson_id');
            $table->string('user_id');
            $table->string('status');
            $table->timestamps();
        });

        DB::table('users')->insert([
            ['id' => self::ADMIN_ID, 'email' => 'admin@linkfit.az', 'display_name' => 'Admin', 'admin_role' => 'admin', 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::PLAYER_ID, 'email' => 'player@linkfit.az', 'display_name' => 'Player', 'admin_role' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT_ID, 'slug' => 'padel']);
        DB::table('venues')->insert(['id' => self::VENUE_ID, 'name' => 'LinkFit Arena']);
        DB::table('courts')->insert([
            'id' => self::COURT_ID,
            'venue_id' => self::VENUE_ID,
            'sport_id' => self::SPORT_ID,
            'name' => 'Court 1',
            'status' => 'active',
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['lesson_bookings', 'lessons', 'coaches', 'courts', 'venues', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_admin_can_create_login_backed_coach_and_coach_can_bootstrap_portal(): void
    {
        $create = app(AdminLessonsController::class)->createCoach($this->requestAs(self::ADMIN_ID, [
            'venue_id' => self::VENUE_ID,
            'sport_id' => self::SPORT_ID,
            'display_name' => 'Coach Portal',
            'email' => 'coach@linkfit.az',
            'password' => 'CoachPassword123',
            'email_verified' => true,
        ]));
        $created = $create->getData(true);

        $this->assertSame(201, $create->getStatusCode());
        $this->assertNotEmpty($created['user_id']);
        $this->assertSame('coach@linkfit.az', $created['user_email']);
        $this->assertDatabaseHas('users', ['email' => 'coach@linkfit.az', 'admin_role' => 'coach']);

        $coachUserId = (string) $created['user_id'];
        $bootstrap = app(CoachPortalController::class)->bootstrap($this->emptyRequestAs($coachUserId));
        $payload = $bootstrap->getData(true);

        $this->assertSame(200, $bootstrap->getStatusCode());
        $this->assertSame('Coach Portal', $payload['coach']['display_name']);
        $this->assertSame('Court 1', $payload['courts'][0]['name']);
        $this->assertSame(0, $payload['stats']['upcoming_lessons']);

        $oldHash = DB::table('users')->where('id', $coachUserId)->value('password_hash');
        app(AdminLessonsController::class)->updateCoach($this->requestAs(self::ADMIN_ID, [
            'display_name' => 'Coach Portal Updated',
            'user_id' => $coachUserId,
            'email' => 'coach-new@linkfit.az',
            'password' => 'NewCoachPassword123',
            'email_verified' => true,
        ]), (string) $created['id']);

        $this->assertDatabaseHas('users', ['id' => $coachUserId, 'email' => 'coach-new@linkfit.az', 'admin_role' => 'coach']);
        $this->assertNotSame($oldHash, DB::table('users')->where('id', $coachUserId)->value('password_hash'));
    }

    public function test_regular_user_cannot_open_coach_portal(): void
    {
        $this->expectException(\App\Support\ApiException::class);

        app(CoachPortalController::class)->bootstrap($this->emptyRequestAs(self::PLAYER_ID));
    }

    private function requestAs(string $userId, array $body): Request
    {
        $request = Request::create('/api/v1/admin/coaches', 'POST', $body);
        $request->attributes->set('auth_user', User::query()->findOrFail($userId));

        return $request;
    }

    private function emptyRequestAs(string $userId): Request
    {
        $request = Request::create('/api/v1/coach/bootstrap', 'GET');
        $request->attributes->set('auth_user', User::query()->findOrFail($userId));

        return $request;
    }
}
