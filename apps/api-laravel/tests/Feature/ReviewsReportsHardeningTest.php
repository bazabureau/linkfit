<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ReportsController;
use App\Http\Controllers\Api\VenueReviewsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Hardening for the reviews + reports/moderation slice. Drives the controllers
 * directly (synthetic Request with the `auth_user` attribute set), mirroring
 * ReviewEligibilityTest / SocialHardeningTest — exercising the authorization +
 * input + PII guards without the JWT middleware/HTTP stack against an in-memory
 * sqlite schema.
 *
 * Covers:
 *   - reports: store happy/self-report/unknown-target, me/reports staff-PII
 *     redaction + reporter scoping, admin index authz, admin update + audit,
 *     admin show malformed-id 404.
 *   - reviews: partner cross-venue IDOR on remove, partner remove happy path
 *     (soft-delete + audit + rating refresh).
 */
class ReviewsReportsHardeningTest extends TestCase
{
    private const REPORTER = '00000000-0000-4000-8000-000000000a01';

    private const MODERATOR = '00000000-0000-4000-8000-000000000a02';

    private const ADMIN = '00000000-0000-4000-8000-000000000a03';

    private const OTHER = '00000000-0000-4000-8000-000000000a04';

    private const PARTNER = '00000000-0000-4000-8000-000000000a05';

    private const GHOST = '00000000-0000-4000-8000-0000000000ff';

    private const VENUE_A = '00000000-0000-4000-8000-000000000b01';

    private const VENUE_B = '00000000-0000-4000-8000-000000000b02';

    private const REVIEW_A = '00000000-0000-4000-8000-000000000c01';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('broadcasting.default', 'log');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->string('admin_role')->nullable();
            $table->timestamp('deleted_at')->nullable();
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
            $table->string('entity_id');
            $table->text('metadata')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('owner_user_id')->nullable();
            $table->decimal('rating_avg', 4, 2)->nullable();
            $table->integer('rating_count')->default(0);
            $table->timestamp('updated_at')->nullable();
        });
        Schema::create('venue_reviews', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('author_user_id');
            $table->integer('rating');
            $table->text('body')->nullable();
            $table->string('photo_url')->nullable();
            $table->timestamp('removed_at')->nullable();
            $table->timestamps();
        });

        DB::table('users')->insert([
            ['id' => self::REPORTER, 'email' => 'reporter@example.com', 'display_name' => 'Reporter', 'admin_role' => null],
            ['id' => self::MODERATOR, 'email' => 'mod@example.com', 'display_name' => 'Mod', 'admin_role' => 'moderator'],
            ['id' => self::ADMIN, 'email' => 'admin@example.com', 'display_name' => 'Admin', 'admin_role' => 'admin'],
            ['id' => self::OTHER, 'email' => 'other@example.com', 'display_name' => 'Other', 'admin_role' => null],
            ['id' => self::PARTNER, 'email' => 'partner@example.com', 'display_name' => 'Partner', 'admin_role' => null],
        ]);
        DB::table('venues')->insert([
            ['id' => self::VENUE_A, 'name' => 'Venue A', 'owner_user_id' => self::OTHER, 'rating_count' => 1, 'rating_avg' => 5.0],
            ['id' => self::VENUE_B, 'name' => 'Venue B', 'owner_user_id' => self::PARTNER, 'rating_count' => 0, 'rating_avg' => null],
        ]);
        DB::table('venue_reviews')->insert([
            'id' => self::REVIEW_A,
            'venue_id' => self::VENUE_A,
            'author_user_id' => self::REPORTER,
            'rating' => 5,
            'body' => 'Great',
            'photo_url' => null,
            'removed_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['venue_reviews', 'venues', 'audit_log', 'reports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- reports: store ----

    public function test_store_report_creates_pending_row(): void
    {
        $response = app(ReportsController::class)->store($this->request(self::REPORTER, [
            'target_kind' => 'user',
            'target_id' => self::OTHER,
            'reason' => 'spam',
            'notes' => 'bad actor',
        ]));

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('reports')->count());
        $row = DB::table('reports')->first();
        $this->assertSame('pending', $row->status);
        $this->assertSame(self::REPORTER, $row->reporter_user_id);
        $this->assertSame(self::OTHER, $row->target_id);
    }

    public function test_cannot_report_self(): void
    {
        $status = $this->statusOf(fn () => app(ReportsController::class)->store($this->request(self::REPORTER, [
            'target_kind' => 'user',
            'target_id' => self::REPORTER,
            'reason' => 'spam',
        ])));

        $this->assertSame(422, $status);
        $this->assertSame(0, DB::table('reports')->count());
    }

    public function test_cannot_report_unknown_target(): void
    {
        $status = $this->statusOf(fn () => app(ReportsController::class)->store($this->request(self::REPORTER, [
            'target_kind' => 'user',
            'target_id' => self::GHOST,
            'reason' => 'spam',
        ])));

        $this->assertSame(404, $status);
        $this->assertSame(0, DB::table('reports')->count());
    }

    // ---- reports: me/reports ----

    public function test_mine_redacts_reviewing_moderator_pii(): void
    {
        DB::table('reports')->insert([
            'id' => (string) Str::uuid(),
            'reporter_user_id' => self::REPORTER,
            'target_kind' => 'user',
            'target_id' => self::OTHER,
            'reason' => 'spam',
            'status' => 'reviewed',
            'notes' => null,
            'reviewed_by_user_id' => self::MODERATOR,
            'reviewed_at' => now(),
            'created_at' => now(),
        ]);

        $data = app(ReportsController::class)->mine($this->request(self::REPORTER))->getData(true);

        $this->assertCount(1, $data['reports']);
        $reviewedBy = $data['reports'][0]['reviewed_by'];
        $this->assertNotNull($reviewedBy, 'reviewed_by object shape must be preserved');
        $this->assertSame(self::MODERATOR, $reviewedBy['id']);
        $this->assertSame('Mod', $reviewedBy['display_name']);
        // The moderator's email + admin_role must NOT leak to the reporter.
        $this->assertNull($reviewedBy['email']);
        $this->assertNull($reviewedBy['admin_role']);
    }

    public function test_mine_only_returns_own_reports(): void
    {
        DB::table('reports')->insert([
            ['id' => (string) Str::uuid(), 'reporter_user_id' => self::REPORTER, 'target_kind' => 'user', 'target_id' => self::OTHER, 'reason' => 'spam', 'status' => 'pending', 'created_at' => now()],
            ['id' => (string) Str::uuid(), 'reporter_user_id' => self::OTHER, 'target_kind' => 'user', 'target_id' => self::REPORTER, 'reason' => 'spam', 'status' => 'pending', 'created_at' => now()],
        ]);

        $data = app(ReportsController::class)->mine($this->request(self::REPORTER))->getData(true);

        $this->assertCount(1, $data['reports']);
        $this->assertSame(self::REPORTER, $data['reports'][0]['reporter_user_id']);
    }

    // ---- reports: admin ----

    public function test_admin_index_requires_admin(): void
    {
        $status = $this->statusOf(fn () => app(ReportsController::class)->adminIndex($this->request(self::REPORTER)));

        $this->assertSame(403, $status);
    }

    public function test_admin_update_sets_status_and_writes_audit(): void
    {
        $id = (string) Str::uuid();
        DB::table('reports')->insert([
            'id' => $id,
            'reporter_user_id' => self::REPORTER,
            'target_kind' => 'user',
            'target_id' => self::OTHER,
            'reason' => 'spam',
            'status' => 'pending',
            'created_at' => now(),
        ]);

        $response = app(ReportsController::class)->adminUpdate(
            $this->request(self::ADMIN, ['status' => 'reviewed', 'notes' => 'handled']),
            $id
        );

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('reports')->where('id', $id)->first();
        $this->assertSame('reviewed', $row->status);
        $this->assertSame(self::ADMIN, $row->reviewed_by_user_id);
        $this->assertNotNull($row->reviewed_at);
        $this->assertSame(1, DB::table('audit_log')->where('action', 'report.review')->where('entity_id', $id)->count());
    }

    public function test_admin_show_rejects_malformed_id(): void
    {
        $status = $this->statusOf(fn () => app(ReportsController::class)->adminShow($this->request(self::ADMIN), 'not-a-uuid'));

        $this->assertSame(404, $status);
    }

    // ---- reviews: partner moderation ----

    public function test_partner_cannot_remove_review_of_another_venue(): void
    {
        // Partner owns VENUE_B; the review lives on VENUE_A → must 404, never
        // touch the row (cross-venue IDOR guard via reviewForVenue scoping).
        $status = $this->statusOf(fn () => app(VenueReviewsController::class)->partnerRemove(
            $this->partnerRequest(),
            self::REVIEW_A
        ));

        $this->assertSame(404, $status);
        $this->assertNull(DB::table('venue_reviews')->where('id', self::REVIEW_A)->value('removed_at'));
    }

    public function test_partner_can_remove_own_venue_review(): void
    {
        $reviewId = (string) Str::uuid();
        DB::table('venue_reviews')->insert([
            'id' => $reviewId,
            'venue_id' => self::VENUE_B,
            'author_user_id' => self::OTHER,
            'rating' => 2,
            'body' => 'meh',
            'photo_url' => null,
            'removed_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = app(VenueReviewsController::class)->partnerRemove($this->partnerRequest(), $reviewId);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertNotNull(DB::table('venue_reviews')->where('id', $reviewId)->value('removed_at'));
        $this->assertSame(1, DB::table('audit_log')->where('action', 'partner.review.remove')->where('entity_id', $reviewId)->count());
        // Rating aggregate refreshed: VENUE_B now has zero live reviews.
        $this->assertSame(0, (int) DB::table('venues')->where('id', self::VENUE_B)->value('rating_count'));
    }

    // ---- helpers ----

    private function request(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/x', 'POST', $body);
        $request->attributes->set('auth_user', $this->userModel($userId));

        return $request;
    }

    private function partnerRequest(): Request
    {
        $request = Request::create('/api/v1/partner/reviews', 'POST', []);
        $user = $this->userModel(self::PARTNER);
        $user->forceFill(['admin_role' => 'partner', 'venue_id' => self::VENUE_B]);
        $request->attributes->set('auth_user', $user);

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
