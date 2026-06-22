<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\LaunchWaitlistController;
use App\Mail\LinkfitTransactionalMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The waitlist signup sends an automatic LinkFit-styled welcome email on the
 * FIRST signup only (not on a duplicate re-submit), and that email carries no
 * CTA button.
 */
class WaitlistWelcomeEmailTest extends TestCase
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
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('launch_waitlist_entries');
        parent::tearDown();
    }

    private function submit(array $body): JsonResponse
    {
        $request = Request::create('/api/v1/launch-waitlist', 'POST', $body);

        return app(LaunchWaitlistController::class)->store($request);
    }

    public function test_new_signup_sends_welcome_email(): void
    {
        Mail::fake();

        $response = $this->submit([
            'name' => 'Test Player',
            'email' => 'newjoiner@example.com',
            'locale' => 'az',
        ]);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('launch_waitlist_entries')->count());
        Mail::assertSent(LinkfitTransactionalMail::class, 1);
    }

    public function test_welcome_email_is_azerbaijani_and_has_no_cta_button(): void
    {
        Mail::fake();

        $this->submit([
            'name' => 'Buttonless Test',
            'email' => 'nobutton@example.com',
            'locale' => 'az',
        ]);

        Mail::assertSent(LinkfitTransactionalMail::class, function (LinkfitTransactionalMail $mail): bool {
            $html = $mail->render();

            return str_contains($html, 'gözləmə siyahısına')
                && ! str_contains($html, 'If the button does not work')
                && ! str_contains($html, 'b8ff00'); // the lime CTA button colour is absent
        });
    }

    public function test_duplicate_signup_does_not_resend(): void
    {
        Mail::fake();

        DB::table('launch_waitlist_entries')->insert([
            'id' => '00000000-0000-4000-8000-0000000b0001',
            'name' => 'Already Here',
            'email' => 'dup@example.com',
            'role' => 'player',
            'locale' => 'az',
            'source' => 'web_waitlist',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->submit([
            'name' => 'Already Here',
            'email' => 'dup@example.com',
            'locale' => 'az',
        ]);

        $this->assertSame(200, $response->getStatusCode());
        Mail::assertNothingSent();
    }
}
