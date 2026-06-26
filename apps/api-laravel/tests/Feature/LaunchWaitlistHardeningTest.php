<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\LaunchWaitlistController;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Input-validation hardening for the public launch-waitlist signup. The happy
 * path + welcome-email + duplicate behaviour live in WaitlistWelcomeEmailTest;
 * this focuses on rejecting malformed input (422) and not persisting it.
 */
class LaunchWaitlistHardeningTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('launch_waitlist_entries', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('phone')->nullable();
            $table->string('role')->default('player');
            $table->string('locale')->default('az');
            $table->string('source')->default('web_waitlist');
            $table->text('message')->nullable();
            $table->string('ip_address')->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Mail::fake();
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('launch_waitlist_entries');
        parent::tearDown();
    }

    public function test_missing_name_is_rejected(): void
    {
        $this->assertRejected(['email' => 'a@example.com']);
    }

    public function test_short_name_is_rejected(): void
    {
        $this->assertRejected(['name' => 'A', 'email' => 'a@example.com']);
    }

    public function test_invalid_email_is_rejected(): void
    {
        $this->assertRejected(['name' => 'Valid Name', 'email' => 'not-an-email']);
    }

    public function test_invalid_role_enum_is_rejected(): void
    {
        $this->assertRejected(['name' => 'Valid Name', 'email' => 'a@example.com', 'role' => 'superadmin']);
    }

    public function test_invalid_locale_enum_is_rejected(): void
    {
        $this->assertRejected(['name' => 'Valid Name', 'email' => 'a@example.com', 'locale' => 'fr']);
    }

    public function test_email_is_lowercased_on_persist(): void
    {
        $response = $this->submit(['name' => 'Mixed Case', 'email' => 'Mixed@Example.COM']);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertDatabaseHas('launch_waitlist_entries', ['email' => 'mixed@example.com']);
        $this->assertSame(0, (int) DB::table('launch_waitlist_entries')->where('email', 'Mixed@Example.COM')->count());
    }

    private function assertRejected(array $body): void
    {
        try {
            $this->submit($body);
            $this->fail('Expected ApiException (422) but none was thrown');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertSame(0, (int) DB::table('launch_waitlist_entries')->count());
    }

    private function submit(array $body): JsonResponse
    {
        $request = Request::create('/api/v1/launch-waitlist', 'POST', $body);

        return app(LaunchWaitlistController::class)->store($request);
    }
}
