<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\ReferralsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReferralRedeemTest extends TestCase
{
    private const REFERRER = '00000000-0000-4000-8000-000000000b01';

    private const REFEREE = '00000000-0000-4000-8000-000000000b02';

    private const REFERRER_CODE = 'ABC234';

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
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->string('referral_code')->nullable()->unique();
            $table->string('referred_by_user_id')->nullable();
            $table->integer('referral_count')->default(0);
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('referrals', function ($table): void {
            // Mirrors the production ledger: PK on referee, so each account
            // can be referred at most once.
            $table->string('referee_user_id')->primary();
            $table->string('referrer_user_id');
            $table->string('code_used');
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            [
                'id' => self::REFERRER,
                'email' => 'referrer@example.com',
                'display_name' => 'Referrer',
                'referral_code' => self::REFERRER_CODE,
                'referral_count' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => self::REFEREE,
                'email' => 'referee@example.com',
                'display_name' => 'Referee',
                'referral_code' => 'XYZ789',
                'referral_count' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('referrals');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function requestFor(string $userId, array $body): Request
    {
        $request = Request::create('/api/v1/auth/redeem-referral', 'POST', $body);
        $request->attributes->set('auth_user', User::findOrFail($userId));

        return $request;
    }

    public function test_redeem_with_valid_code_succeeds_and_increments_count_once(): void
    {
        $controller = app(ReferralsController::class);

        $response = $controller->redeem($this->requestFor(self::REFEREE, ['code' => self::REFERRER_CODE]));

        $this->assertSame(200, $response->getStatusCode());

        // Ledger row created, keyed on the referee.
        $row = DB::table('referrals')->where('referee_user_id', self::REFEREE)->first();
        $this->assertNotNull($row);
        $this->assertSame(self::REFERRER, $row->referrer_user_id);
        $this->assertSame(self::REFERRER_CODE, $row->code_used);

        // Denormalized columns updated.
        $this->assertSame(self::REFERRER, DB::table('users')->where('id', self::REFEREE)->value('referred_by_user_id'));
        $this->assertSame(1, (int) DB::table('users')->where('id', self::REFERRER)->value('referral_count'));
    }

    public function test_redeeming_your_own_code_is_rejected_with_422(): void
    {
        $controller = app(ReferralsController::class);

        try {
            $controller->redeem($this->requestFor(self::REFERRER, ['code' => self::REFERRER_CODE]));
            $this->fail('Expected ApiException for self-redeem');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }

        $this->assertSame(0, DB::table('referrals')->count());
        $this->assertSame(0, (int) DB::table('users')->where('id', self::REFERRER)->value('referral_count'));
    }

    public function test_redeeming_when_already_redeemed_is_rejected_with_409_not_500(): void
    {
        $controller = app(ReferralsController::class);

        // First redeem succeeds.
        $controller->redeem($this->requestFor(self::REFEREE, ['code' => self::REFERRER_CODE]));

        // Second redeem for the same referee must surface a clean 409, not a 500.
        try {
            $controller->redeem($this->requestFor(self::REFEREE, ['code' => self::REFERRER_CODE]));
            $this->fail('Expected ApiException for already-redeemed referral');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
            $this->assertSame('CONFLICT', $e->wireCode());
        }

        // Count was bumped exactly once across both attempts.
        $this->assertSame(1, (int) DB::table('users')->where('id', self::REFERRER)->value('referral_count'));
    }

    public function test_redeeming_when_already_redeemed_bypassing_fast_path_still_returns_409(): void
    {
        $controller = app(ReferralsController::class);

        // Seed the ledger row directly so the pre-check exists() path is the
        // one that fires — proves the existing fast-path 409 still holds.
        DB::table('referrals')->insert([
            'referee_user_id' => self::REFEREE,
            'referrer_user_id' => self::REFERRER,
            'code_used' => self::REFERRER_CODE,
            'created_at' => now(),
        ]);

        try {
            $controller->redeem($this->requestFor(self::REFEREE, ['code' => self::REFERRER_CODE]));
            $this->fail('Expected ApiException for already-redeemed referral');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_concurrent_redeem_losing_insert_surfaces_409_not_500(): void
    {
        // Simulate the TOCTOU race deterministically: the fast-path exists()
        // check passes (ledger empty), then a "concurrent" redeem lands the
        // referee's row just before our INSERT runs. The PK violation must be
        // caught and translated to 409 — never bubble up as an unhandled 500.
        $controller = app(ReferralsController::class);
        $injected = false;

        // beforeExecuting fires immediately *before* each query runs. When the
        // controller is about to INSERT the referee's ledger row, we slip the
        // conflicting row in first (the "winning" concurrent redeem) so the
        // controller's own INSERT hits the PK constraint.
        DB::connection('sqlite')->beforeExecuting(function ($query, $bindings, $connection) use (&$injected): void {
            if (! $injected && str_contains($query, 'insert into "referrals"')) {
                $injected = true;
                $connection->getPdo()->exec(sprintf(
                    "INSERT INTO referrals (referee_user_id, referrer_user_id, code_used, created_at) VALUES ('%s','%s','%s','%s')",
                    self::REFEREE,
                    self::REFERRER,
                    self::REFERRER_CODE,
                    now()->toDateTimeString(),
                ));
            }
        });

        try {
            $controller->redeem($this->requestFor(self::REFEREE, ['code' => self::REFERRER_CODE]));
            $this->fail('Expected ApiException for the losing concurrent redeem');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
            $this->assertSame('CONFLICT', $e->wireCode());
        }

        $this->assertTrue($injected, 'Expected the conflicting insert to be injected mid-flight');
    }

    public function test_redeeming_an_unknown_code_returns_404(): void
    {
        $controller = app(ReferralsController::class);

        try {
            $controller->redeem($this->requestFor(self::REFEREE, ['code' => 'ZZZ999']));
            $this->fail('Expected ApiException for unknown code');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }

        $this->assertSame(0, DB::table('referrals')->count());
    }
}
