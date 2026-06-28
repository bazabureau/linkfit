<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ReportsController;
use App\Http\Controllers\Api\StoriesController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Apple Guideline 1.2 "functional 24h moderation" coverage for the
 * moderation-hide flow. Drives the controllers directly (synthetic Request with
 * the `auth_user` attribute set) against an in-memory sqlite schema, mirroring
 * ReviewsReportsHardeningTest / StoriesFeedHardeningTest.
 *
 * Covers:
 *   (a) THRESHOLD distinct reporters flagging the same story → an ACTIVE
 *       moderation_hides row is created AND the story is excluded from the
 *       public stories feed.
 *   (b) Below threshold → no hide row, the story is still visible.
 *   (c) Admin PATCH hide_target=true → an active hide is created → story hidden.
 *   (d) Admin PATCH clear_hide=true → the hide is cleared → story visible again.
 */
class ModerationHideTest extends TestCase
{
    private const AUTHOR = '00000000-0000-4000-8000-000000000d01';

    private const VIEWER = '00000000-0000-4000-8000-000000000d02';

    private const ADMIN = '00000000-0000-4000-8000-000000000d03';

    private const R1 = '00000000-0000-4000-8000-000000000d11';

    private const R2 = '00000000-0000-4000-8000-000000000d12';

    private const R3 = '00000000-0000-4000-8000-000000000d13';

    private const STORY = '00000000-0000-4000-8000-000000000e01';

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
            $table->index(['target_kind', 'target_id']);
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
        Schema::create('story_views', function ($table): void {
            $table->string('story_id');
            $table->string('viewer_user_id');
            $table->timestamp('viewed_at')->nullable();
            $table->primary(['story_id', 'viewer_user_id']);
        });
        Schema::create('story_reactions', function ($table): void {
            $table->string('story_id');
            $table->string('user_id');
            $table->string('emoji')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->primary(['story_id', 'user_id']);
        });
        Schema::create('story_mentions', function ($table): void {
            $table->string('story_id');
            $table->string('mentioned_user_id');
            $table->float('x')->nullable();
            $table->float('y')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->primary(['story_id', 'mentioned_user_id']);
        });
        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
            $table->timestamp('created_at')->nullable();
            $table->primary(['blocker_user_id', 'blocked_user_id']);
        });

        DB::table('users')->insert([
            ['id' => self::AUTHOR, 'email' => 'author@example.com', 'display_name' => 'Author', 'admin_role' => null],
            ['id' => self::VIEWER, 'email' => 'viewer@example.com', 'display_name' => 'Viewer', 'admin_role' => null],
            ['id' => self::ADMIN, 'email' => 'admin@example.com', 'display_name' => 'Admin', 'admin_role' => 'admin'],
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
        foreach ([
            'user_blocks', 'story_mentions', 'story_reactions', 'story_views',
            'stories', 'moderation_hides', 'audit_log', 'reports', 'users',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- (a) threshold auto-hide + feed exclusion ----

    public function test_threshold_distinct_reporters_autohides_story_and_excludes_from_feed(): void
    {
        // The story is visible before any reports.
        $this->assertContains(self::STORY, $this->feedStoryIds());

        $this->fileReport(self::R1);
        $this->fileReport(self::R2);
        // Two distinct reporters is below the threshold of 3 — still no hide.
        $this->assertSame(0, $this->activeHideCount());
        $this->assertContains(self::STORY, $this->feedStoryIds());

        $this->fileReport(self::R3);

        // Third distinct reporter crosses the threshold → exactly one active hide.
        $this->assertSame(1, $this->activeHideCount());
        $hide = DB::table('moderation_hides')->where('target_id', self::STORY)->first();
        $this->assertEquals(1, (int) $hide->auto, 'auto-hide row must be flagged auto=true');
        $this->assertSame(3, (int) $hide->report_count);
        $this->assertSame('spam', $hide->reason, 'reason should be the most frequent pending reason');
        // The author is NOT auto-suspended (brigading guard).
        $this->assertNull(DB::table('users')->where('id', self::AUTHOR)->value('suspended_at'));
        // An autohide audit row exists.
        $this->assertSame(1, DB::table('audit_log')->where('action', 'moderation.autohide')->count());

        // The hidden story disappears from the public feed.
        $this->assertNotContains(self::STORY, $this->feedStoryIds());
    }

    public function test_a_single_reporter_filing_twice_does_not_cross_threshold(): void
    {
        // Distinct-reporter counting: the same person flagging 3 times is 1
        // reporter, not 3 — so no auto-hide and the story stays visible.
        $this->fileReport(self::R1);
        $this->fileReport(self::R1);
        $this->fileReport(self::R1);

        $this->assertSame(0, $this->activeHideCount());
        $this->assertContains(self::STORY, $this->feedStoryIds());
    }

    // ---- (b) below threshold ----

    public function test_below_threshold_keeps_story_visible(): void
    {
        $this->fileReport(self::R1);
        $this->fileReport(self::R2);

        $this->assertSame(0, $this->activeHideCount());
        $this->assertContains(self::STORY, $this->feedStoryIds());
    }

    // ---- (c) admin manual hide ----

    public function test_admin_hide_target_hides_story(): void
    {
        $reportId = $this->insertReport(self::R1);

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'hide_target' => true]),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $payload = $response->getData(true);
        $this->assertTrue($payload['target_hidden']);
        $hide = DB::table('moderation_hides')->where('target_id', self::STORY)->whereNull('cleared_at')->first();
        $this->assertNotNull($hide);
        $this->assertEquals(0, (int) $hide->auto, 'an admin takedown is auto=false');
        $this->assertSame(self::ADMIN, $hide->hidden_by_user_id);
        $this->assertSame(1, DB::table('audit_log')->where('action', 'moderation.hide')->count());

        $this->assertNotContains(self::STORY, $this->feedStoryIds());
    }

    // ---- (d) admin clear hide ----

    public function test_admin_clear_hide_restores_visibility(): void
    {
        $reportId = $this->insertReport(self::R1);
        // First hide it.
        app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'hide_target' => true]),
            $reportId,
        );
        $this->assertNotContains(self::STORY, $this->feedStoryIds());

        // Then clear it.
        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'clear_hide' => true]),
            $reportId,
        );

        $this->assertSame(200, $response->getStatusCode());
        $payload = $response->getData(true);
        $this->assertFalse($payload['target_hidden']);
        $this->assertSame(0, $this->activeHideCount());
        // The row is retained (history) but cleared.
        $this->assertSame(1, DB::table('moderation_hides')->whereNotNull('cleared_at')->count());
        $this->assertSame(self::ADMIN, DB::table('moderation_hides')->value('cleared_by_user_id'));
        $this->assertSame(1, DB::table('audit_log')->where('action', 'moderation.unhide')->count());

        $this->assertContains(self::STORY, $this->feedStoryIds());
    }

    // ---- helpers ----

    private function fileReport(string $reporterId, string $reason = 'spam'): void
    {
        app(ReportsController::class)->store($this->request($reporterId, [
            'target_kind' => 'story',
            'target_id' => self::STORY,
            'reason' => $reason,
        ]));
    }

    private function insertReport(string $reporterId, string $reason = 'spam'): string
    {
        $id = (string) Str::uuid();
        DB::table('reports')->insert([
            'id' => $id,
            'reporter_user_id' => $reporterId,
            'target_kind' => 'story',
            'target_id' => self::STORY,
            'reason' => $reason,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        return $id;
    }

    private function activeHideCount(): int
    {
        return (int) DB::table('moderation_hides')
            ->where('target_id', self::STORY)
            ->whereNull('cleared_at')
            ->count();
    }

    /** @return array<int,string> story ids surfaced by the public feed */
    private function feedStoryIds(): array
    {
        $data = app(StoriesController::class)->feed($this->request(self::VIEWER))->getData(true);
        $ids = [];
        foreach ($data['items'] as $group) {
            foreach ($group['stories'] as $story) {
                $ids[] = $story['id'];
            }
        }

        return $ids;
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
}
