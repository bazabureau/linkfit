<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MeController;
use App\Http\Controllers\Api\MedicalController;
use App\Http\Controllers\Api\StoriesController;
use App\Models\User;
use App\Services\Auth\EmailTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Mass-assignment (OWASP API3) regression guard.
 *
 * The consumer-facing write endpoints build their persisted arrays from a
 * `validateBody` allowlist and pin ownership/identity to `authUser()` — never
 * from request input. These tests prove that a sensitive/privileged field
 * supplied in the request body is IGNORED, so a future refactor (e.g. swapping
 * an explicit array for `$request->all()` or `$user->fill($request->all())`)
 * regresses loudly.
 */
class MassAssignmentTest extends TestCase
{
    private const USER_ID = '00000000-0000-4000-8000-0000000a0001';

    private const ATTACKER_TARGET_ID = '00000000-0000-4000-8000-0000000a0002';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        // Story media_url is now constrained to https + an allowlisted host.
        config()->set('media.allowed_hosts', ['cdn.example.com']);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        // Mirrors the legacy `users` table columns the endpoints read/write.
        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('display_name')->nullable();
            $table->string('phone')->nullable();
            $table->string('photo_url')->nullable();
            $table->float('home_lat')->nullable();
            $table->float('home_lng')->nullable();
            $table->string('admin_role')->nullable();
            $table->boolean('is_vip')->default(false);
            $table->boolean('is_verified')->default(false);
            $table->boolean('is_ambassador')->default(false);
            $table->string('venue_id')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('medical_profiles', function ($table): void {
            $table->string('user_id')->primary();
            $table->string('blood_type')->nullable();
            $table->text('allergies')->nullable();
            $table->text('conditions')->nullable();
            $table->text('medications')->nullable();
            $table->string('emergency_contact_name')->nullable();
            $table->string('emergency_contact_phone')->nullable();
            $table->boolean('share_medical_with_host')->default(false);
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('stories', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('media_url');
            $table->string('media_type');
            $table->string('caption')->nullable();
            $table->text('overlays')->nullable();
            $table->integer('view_count')->default(0);
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->nullable();
        });

        Schema::create('story_mentions', function ($table): void {
            $table->string('story_id');
            $table->string('mentioned_user_id');
            $table->float('x');
            $table->float('y');
            $table->timestamp('created_at')->nullable();
            $table->unique(['story_id', 'mentioned_user_id']);
        });

        DB::table('users')->insert([
            [
                'id' => self::USER_ID,
                'email' => 'victim@example.com',
                'display_name' => 'Victim',
                'admin_role' => null,
                'is_vip' => false,
                'email_verified_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => self::ATTACKER_TARGET_ID,
                'email' => 'target@example.com',
                'display_name' => 'Other User',
                'admin_role' => null,
                'is_vip' => false,
                'email_verified_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('story_mentions');
        Schema::dropIfExists('stories');
        Schema::dropIfExists('medical_profiles');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function requestAs(string $userId, string $uri, string $method, array $body): Request
    {
        $request = Request::create($uri, $method, $body);
        $request->attributes->set('auth_user', User::findOrFail($userId));

        return $request;
    }

    private function meController(): MeController
    {
        return new MeController(
            app(PasswordService::class),
            app(EmailTokenService::class),
            app(TransactionalMailService::class),
        );
    }

    /**
     * PATCH /me must apply only the allowlisted profile fields. Privilege and
     * verification columns sent in the body (`admin_role`, `is_vip`,
     * `email_verified_at`, `id`) must be ignored.
     */
    public function test_patch_me_ignores_privileged_body_fields(): void
    {
        $response = $this->meController()->update($this->requestAs(self::USER_ID, '/api/v1/me', 'PATCH', [
            'display_name' => 'Renamed',
            // Mass-assignment attempts — none of these are in the allowlist.
            'admin_role' => 'admin',
            'is_vip' => true,
            'is_verified' => true,
            'is_ambassador' => true,
            'email_verified_at' => now()->toDateTimeString(),
            'id' => self::ATTACKER_TARGET_ID,
            'user_id' => self::ATTACKER_TARGET_ID,
        ]));

        $this->assertSame(200, $response->getStatusCode());

        $row = DB::table('users')->where('id', self::USER_ID)->first();
        // The legitimate field was applied...
        $this->assertSame('Renamed', $row->display_name);
        // ...but every privileged/identity field was ignored.
        $this->assertNull($row->admin_role, 'admin_role must not be settable via PATCH /me');
        $this->assertFalse((bool) $row->is_vip, 'is_vip must not be settable via PATCH /me');
        $this->assertFalse((bool) $row->is_verified, 'is_verified must not be settable via PATCH /me');
        $this->assertFalse((bool) $row->is_ambassador, 'is_ambassador must not be settable via PATCH /me');
        $this->assertNull($row->email_verified_at, 'email_verified_at must not be settable via PATCH /me');
        // The PK was untouched and no row was hijacked onto the other user.
        $this->assertSame('Other User', DB::table('users')->where('id', self::ATTACKER_TARGET_ID)->value('display_name'));
    }

    /**
     * PUT /me/medical-profile must key the row on `authUser()->id`, ignoring any
     * `user_id` in the body — a client cannot write another user's profile.
     */
    public function test_medical_profile_update_pins_owner_to_auth_user(): void
    {
        $response = app(MedicalController::class)->update(
            $this->requestAs(self::USER_ID, '/api/v1/me/medical-profile', 'PUT', [
                'blood_type' => 'O+',
                'share_medical_with_host' => true,
                // Attempt to write onto another user's profile row.
                'user_id' => self::ATTACKER_TARGET_ID,
            ])
        );

        $this->assertSame(200, $response->getStatusCode());

        // Exactly one profile row, owned by the authed user — not the target.
        $this->assertSame(1, DB::table('medical_profiles')->count());
        $this->assertSame('O+', DB::table('medical_profiles')->where('user_id', self::USER_ID)->value('blood_type'));
        $this->assertNull(
            DB::table('medical_profiles')->where('user_id', self::ATTACKER_TARGET_ID)->first(),
            'medical profile must never be written onto a body-supplied user_id',
        );
    }

    /**
     * POST /stories must stamp `user_id` from `authUser()`, ignoring a body
     * `user_id` — a client cannot publish a story as another user.
     */
    public function test_story_create_pins_user_id_to_auth_user(): void
    {
        $response = app(StoriesController::class)->store(
            $this->requestAs(self::USER_ID, '/api/v1/stories', 'POST', [
                'media_url' => 'https://cdn.example.com/s/1.jpg',
                'media_type' => 'image',
                'caption' => 'hello',
                // Attempt to publish as another user.
                'user_id' => self::ATTACKER_TARGET_ID,
            ])
        );

        $this->assertSame(201, $response->getStatusCode());

        $story = DB::table('stories')->first();
        $this->assertNotNull($story);
        $this->assertSame(self::USER_ID, $story->user_id, 'story ownership must come from authUser, not the body');
        $this->assertSame(0, DB::table('stories')->where('user_id', self::ATTACKER_TARGET_ID)->count());
    }
}
