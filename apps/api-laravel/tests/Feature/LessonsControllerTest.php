<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\LessonsController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LessonsControllerTest extends TestCase
{
    private const COACH_ID = 'coach-1';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

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
            $table->string('name');
        });
        Schema::create('coaches', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name');
            $table->string('photo_url')->nullable();
            $table->text('bio')->nullable();
            $table->float('rating')->nullable();
            $table->integer('years_experience')->nullable();
            $table->integer('hourly_rate_minor')->nullable();
            $table->string('currency')->nullable();
            $table->string('sport_id')->nullable();
            $table->string('venue_id')->nullable();
            $table->boolean('is_active')->default(true);
        });
        Schema::create('lessons', function ($table): void {
            $table->string('id')->primary();
            $table->string('coach_id');
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
            $table->string('venue_id')->nullable();
            $table->string('court_id')->nullable();
            $table->string('sport_id')->nullable();
        });
        Schema::create('lesson_bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('lesson_id');
            $table->string('user_id');
            $table->string('status');
            $table->timestamps();
        });

        DB::table('sports')->insert(['id' => 'sport-1', 'slug' => 'padel']);
        DB::table('venues')->insert(['id' => 'venue-1', 'name' => 'LinkFit Court']);
        DB::table('courts')->insert(['id' => 'court-1', 'name' => 'Court 1']);
        DB::table('coaches')->insert([
            'id' => self::COACH_ID,
            'display_name' => 'Coach One',
            'photo_url' => null,
            'bio' => 'Padel coach',
            'rating' => 4.8,
            'years_experience' => 7,
            'hourly_rate_minor' => 9000,
            'currency' => 'AZN',
            'sport_id' => 'sport-1',
            'venue_id' => 'venue-1',
            'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('lesson_bookings');
        Schema::dropIfExists('lessons');
        Schema::dropIfExists('coaches');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');

        parent::tearDown();
    }

    public function test_coaches_list_includes_main_columns_and_rating_count(): void
    {
        $response = app(LessonsController::class)->coaches(Request::create('/api/v1/coaches', 'GET'));
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(self::COACH_ID, $payload['items'][0]['id']);
        $this->assertSame('Coach One', $payload['items'][0]['display_name']);
        $this->assertSame(0, $payload['items'][0]['rating_count']);
    }

    public function test_coach_detail_includes_main_columns_and_rating_count(): void
    {
        $response = app(LessonsController::class)->coach(Request::create('/api/v1/coaches/'.self::COACH_ID, 'GET'), self::COACH_ID);
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(self::COACH_ID, $payload['id']);
        $this->assertSame('Coach One', $payload['display_name']);
        $this->assertSame(0, $payload['rating_count']);
    }
}
