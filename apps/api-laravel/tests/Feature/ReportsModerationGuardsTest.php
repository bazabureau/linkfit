<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ReportsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Hardening for the moderation guards added to ReportsController::adminUpdate:
 *   #1 suspend_user must reuse the AdminOps assertCanDisableUser guard — a
 *      moderator cannot suspend an admin/moderator (privilege escalation), and
 *      nobody may suspend themselves; an admin still can suspend staff.
 *   #3 a moderation hide is only created for the 4 ENFORCED content kinds — a
 *      user target is suspended, never content-hidden (auto OR admin hide_target).
 *   #5 a long moderator note is truncated to 255 before it reaches the
 *      moderation_hides.reason varchar(255) column.
 *   #9 dismissing a report clears any active auto-hide; reviewing keeps it.
 *
 * Drives the controller directly (synthetic Request with `auth_user`), mirroring
 * ModerationHideTest / ReviewsReportsHardeningTest against in-memory sqlite.
 */
class ReportsModerationGuardsTest extends TestCase
{
    private const MOD = '00000000-0000-4000-8000-000000000f01';

    private const ADMIN = '00000000-0000-4000-8000-000000000f02';

    private const PLAYER = '00000000-0000-4000-8000-000000000f03';

    private const TARGET_ADMIN = '00000000-0000-4000-8000-000000000f04';

    private const TARGET_MOD = '00000000-0000-4000-8000-000000000f05';

    private const AUTHOR = '00000000-0000-4000-8000-000000000f06';

    private const R1 = '00000000-0000-4000-8000-000000000f11';

    private const R2 = '00000000-0000-4000-8000-000000000f12';

    private const R3 = '00000000-0000-4000-8000-000000000f13';

    private const STORY = '00000000-0000-4000-8000-000000000f21';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('broadcasting.default', 'log');
        config()->set('moderation.autohide_threshold', 3);
        config()->set('moderation.alert_email', null);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->string('admin_role')->nullable();
            $table->timestamp('suspended_at')->nullable();
            $table->string('suspension_reason')->nullable();
            $table->string('suspended_by_user_id')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });
        Schema::create('reports', function ($table): void {
            $table->string('id')->primary();
            $table->string('reporter_user_id');
            $table->string('target_kind');
            $table->string('target_id');
            $table->string('reason');
            $table->string('status');
            $table->text('notes')->nullable();
            $table->string('reviewed_by_user_id')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('audit_log', function ($table): void {
            $table->string('id')->primary();
            $table->string('actor_user_id')->nullable();
            $table->string('action');
            $table->string('entity');
            $table->string('entity_id')->nullable();
            $table->text('metadata')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('moderation_hides', function ($table): void {
            $table->string('id')->primary();
            $table->string('target_kind');
            $table->string('target_id');
            $table->timestamp('hidden_at')->nullable();
            $table->string('reason')->nullable();
            $table->boolean('auto')->default(true);
            $table->integer('report_count')->default(0);
            $table->string('hidden_by_user_id')->nullable();
            $table->timestamp('cleared_at')->nullable();
            $table->string('cleared_by_user_id')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('stories', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('media_url')->nullable();
            $table->string('media_type')->nullable();
            $table->string('caption')->nullable();
            $table->text('overlays')->nullable();
            $table->integer('view_count')->default(0);
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::MOD, 'email' => 'mod@example.com', 'display_name' => 'Mod', 'admin_role' => 'moderator'],
            ['id' => self::ADMIN, 'email' => 'admin@example.com', 'display_name' => 'Admin', 'admin_role' => 'admin'],
            ['id' => self::PLAYER, 'email' => 'player@example.com', 'display_name' => 'Player', 'admin_role' => null],
            ['id' => self::TARGET_ADMIN, 'email' => 'target-admin@example.com', 'display_name' => 'Target Admin', 'admin_role' => 'admin'],
            ['id' => self::TARGET_MOD, 'email' => 'target-mod@example.com', 'display_name' => 'Target Mod', 'admin_role' => 'moderator'],
            ['id' => self::AUTHOR, 'email' => 'author@example.com', 'display_name' => 'Author', 'admin_role' => null],
            ['id' => self::R1, 'email' => 'r1@example.com', 'display_name' => 'R1', 'admin_role' => null],
            ['id' => self::R2, 'email' => 'r2@example.com', 'display_name' => 'R2', 'admin_role' => null],
            ['id' => self::R3, 'email' => 'r3@example.com', 'display_name' => 'R3', 'admin_role' => null],
        ]);
        DB::table('stories')->insert([
            'id' => self::STORY,
            'user_id' => self::AUTHOR,
            'media_url' => 'https://cdn.linkfit.az/s.jpg',
            'media_type' => 'image',
            'caption' => 'hi',
            'overlays' => '[]',
            'view_count' => 0,
            'created_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['stories', 'moderation_hides', 'audit_log', 'reports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- #1 suspend_user privilege-escalation guard --------------------------

    public function test_moderator_cannot_suspend_an_admin_via_report_queue(): void
    {
        $reportId = $this->insertUserReport(self::TARGET_ADMIN);

        $status = $this->statusOf(fn () => app(ReportsController::class)->adminUpdate(
            $this->request(self::MOD, ['status' => 'reviewed', 'suspend_user' => true]),
            $reportId,
        ));

        $this->assertSame(403, $status);
        $this->assertNull(DB::table('users')->where('id', self::TARGET_ADMIN)->value('suspended_at'));
        // The guard runs BEFORE any write, so the report status is untouched too.
        $this->assertSame('pending', DB::table('reports')->where('id', $reportId)->value('status'));
    }

    public function test_moderator_cannot_suspend_another_moderator_via_report_queue(): void
    {
        $reportId = $this->insertUserReport(self::TARGET_MOD);

        $status = $this->statusOf(fn () => app(ReportsController::class)->adminUpdate(
            $this->request(self::MOD, ['status' => 'reviewed', 'suspend_user' => true]),
            $reportId,
        ));

        $this->assertSame(403, $status);
        $this->assertNull(DB::table('users')->where('id', self::TARGET_MOD)->value('suspended_at'));
    }

    public function test_moderator_cannot_suspend_self_via_report_queue(): void
    {
        $reportId = $this->insertUserReport(self::MOD);

        $status = $this->statusOf(fn () => app(ReportsController::class)->adminUpdate(
            $this->request(self::MOD, ['status' => 'reviewed', 'suspend_user' => true]),
            $reportId,
        ));

        $this->assertSame(409, $status);
        $this->assertNull(DB::table('users')->where('id', self::MOD)->value('suspended_at'));
    }

    public function test_moderator_can_suspend_a_regular_user_via_report_queue(): void
    {
        $reportId = $this->insertUserReport(self::PLAYER);

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::MOD, ['status' => 'reviewed', 'suspend_user' => true]),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNotNull(DB::table('users')->where('id', self::PLAYER)->value('suspended_at'));
        $this->assertSame(self::MOD, DB::table('users')->where('id', self::PLAYER)->value('suspended_by_user_id'));
    }

    public function test_admin_can_suspend_a_moderator_via_report_queue(): void
    {
        $reportId = $this->insertUserReport(self::TARGET_MOD);

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'suspend_user' => true]),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNotNull(DB::table('users')->where('id', self::TARGET_MOD)->value('suspended_at'));
    }

    // ---- #3 hide creation restricted to enforced content kinds ---------------

    public function test_admin_hide_target_is_a_noop_for_a_user_target(): void
    {
        $reportId = $this->insertUserReport(self::PLAYER);

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'hide_target' => true]),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertFalse($response->getData(true)['target_hidden'], 'a user target is suspended, never content-hidden');
        $this->assertSame(0, DB::table('moderation_hides')->count());
    }

    public function test_user_target_is_never_autohidden_at_threshold(): void
    {
        // Three distinct reporters flag a USER target — no content hide is ever
        // created (the enforcement is a suspend, never a hide).
        $this->fileUserReport(self::R1, self::PLAYER);
        $this->fileUserReport(self::R2, self::PLAYER);
        $this->fileUserReport(self::R3, self::PLAYER);

        $this->assertSame(0, DB::table('moderation_hides')->count());
    }

    public function test_story_target_still_autohides_at_threshold(): void
    {
        // Control: an ENFORCED content kind (story) DOES auto-hide at threshold.
        $this->fileStoryReport(self::R1);
        $this->fileStoryReport(self::R2);
        $this->fileStoryReport(self::R3);

        $this->assertSame(1, DB::table('moderation_hides')->where('target_id', self::STORY)->whereNull('cleared_at')->count());
    }

    // ---- #5 reason truncation (varchar(255)) ---------------------------------

    public function test_long_moderator_note_is_truncated_for_the_hide_reason(): void
    {
        $reportId = $this->insertStoryReport(self::R1);
        $longNote = str_repeat('x', 4000);

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'hide_target' => true, 'notes' => $longNote]),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $reason = DB::table('moderation_hides')->where('target_id', self::STORY)->value('reason');
        $this->assertSame(255, mb_strlen((string) $reason), 'reason must be clamped to the varchar(255) column width');
    }

    // ---- #9 dismiss clears an active auto-hide -------------------------------

    public function test_dismissing_a_report_clears_the_active_autohide(): void
    {
        $this->fileStoryReport(self::R1);
        $this->fileStoryReport(self::R2);
        $reportId = $this->fileStoryReport(self::R3);
        $this->assertSame(1, DB::table('moderation_hides')->whereNull('cleared_at')->count());

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'dismissed']),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertFalse($response->getData(true)['target_hidden']);
        $this->assertSame(0, DB::table('moderation_hides')->whereNull('cleared_at')->count());
        $this->assertSame(1, DB::table('audit_log')->where('action', 'moderation.unhide')->count());
    }

    public function test_reviewing_a_report_keeps_the_active_autohide(): void
    {
        $this->fileStoryReport(self::R1);
        $this->fileStoryReport(self::R2);
        $reportId = $this->fileStoryReport(self::R3);
        $this->assertSame(1, DB::table('moderation_hides')->whereNull('cleared_at')->count());

        app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed']),
            $reportId,
        );

        $this->assertSame(1, DB::table('moderation_hides')->whereNull('cleared_at')->count(), 'a reviewed/upheld report stays hidden');
    }

    // ---- helpers -------------------------------------------------------------

    private function insertUserReport(string $targetId): string
    {
        $id = (string) Str::uuid();
        DB::table('reports')->insert([
            'id' => $id,
            'reporter_user_id' => self::R1,
            'target_kind' => 'user',
            'target_id' => $targetId,
            'reason' => 'harassment',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        return $id;
    }

    private function insertStoryReport(string $reporterId): string
    {
        $id = (string) Str::uuid();
        DB::table('reports')->insert([
            'id' => $id,
            'reporter_user_id' => $reporterId,
            'target_kind' => 'story',
            'target_id' => self::STORY,
            'reason' => 'spam',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        return $id;
    }

    private function fileUserReport(string $reporterId, string $targetId): void
    {
        app(ReportsController::class)->store($this->request($reporterId, [
            'target_kind' => 'user',
            'target_id' => $targetId,
            'reason' => 'harassment',
        ]));
    }

    /** @return string the created report id */
    private function fileStoryReport(string $reporterId): string
    {
        $response = app(ReportsController::class)->store($this->request($reporterId, [
            'target_kind' => 'story',
            'target_id' => self::STORY,
            'reason' => 'spam',
        ]));

        return $response->getData(true)['id'];
    }

    private function request(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/x', 'POST', $body);
        $request->attributes->set('auth_user', $this->userModel($userId));

        return $request;
    }

    private function userModel(string $userId): User
    {
        $row = DB::table('users')->where('id', $userId)->first();
        $user = new User;
        $user->forceFill([
            'id' => $userId,
            'admin_role' => $row->admin_role ?? null,
            'display_name' => $row->display_name ?? null,
            'email' => $row->email ?? null,
        ]);

        return $user;
    }

    private function statusOf(callable $fn): int
    {
        try {
            $fn();
        } catch (ApiException $e) {
            return $e->getStatusCode();
        }

        return 0;
    }
}
