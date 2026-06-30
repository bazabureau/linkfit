<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

/**
 * The private media-serve route: streams an asset ONLY for a valid temporary
 * signature, so private chat media is no longer a permanent public URL.
 */
class MediaServeTest extends TestCase
{
    private const ASSET_ID = '00000000-0000-4000-8000-0000000004aa';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('media_assets', function ($table): void {
            $table->string('id')->primary();
            $table->string('disk');
            $table->string('path');
            $table->string('mime')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Storage::fake('local');
        Storage::disk('local')->put('uploads/2026/06/voice.webm', 'VOICE-BYTES');
        DB::table('media_assets')->insert([
            'id' => self::ASSET_ID,
            'disk' => 'local',
            'path' => 'uploads/2026/06/voice.webm',
            'mime' => 'audio/webm',
            'deleted_at' => null,
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('media_assets');
        parent::tearDown();
    }

    public function test_valid_signature_streams_the_asset(): void
    {
        $url = URL::temporarySignedRoute('media.serve', now()->addMinutes(10), ['media' => self::ASSET_ID]);

        $response = $this->get($url);

        $response->assertOk();
        $this->assertSame('VOICE-BYTES', $response->streamedContent());
        $this->assertSame('audio/webm', $response->headers->get('Content-Type'));
    }

    public function test_missing_signature_is_rejected(): void
    {
        // Bare route URL (no ?signature=) must not serve the bytes.
        $this->get(route('media.serve', ['media' => self::ASSET_ID]))->assertForbidden();
    }

    public function test_tampered_signature_is_rejected(): void
    {
        $url = URL::temporarySignedRoute('media.serve', now()->addMinutes(10), ['media' => self::ASSET_ID]);

        $this->get($url.'0')->assertForbidden();
    }

    public function test_soft_deleted_asset_is_not_found(): void
    {
        DB::table('media_assets')->where('id', self::ASSET_ID)->update(['deleted_at' => now()]);
        $url = URL::temporarySignedRoute('media.serve', now()->addMinutes(10), ['media' => self::ASSET_ID]);

        $this->get($url)->assertNotFound();
    }
}
