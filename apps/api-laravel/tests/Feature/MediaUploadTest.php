<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MediaController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MediaUploadTest extends TestCase
{
    private const USER_ID = '00000000-0000-4000-8000-000000000401';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('filesystems.default', 'public');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
        });
        Schema::create('media_assets', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('disk');
            $table->string('path');
            $table->string('url');
            $table->string('mime');
            $table->integer('size_bytes');
            $table->integer('width')->nullable();
            $table->integer('height')->nullable();
            $table->string('purpose')->nullable();
            $table->timestamps();
        });

        DB::table('users')->insert(['id' => self::USER_ID]);
        Storage::fake('public');
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('media_assets');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_voice_message_upload_accepts_browser_webm_audio(): void
    {
        $file = UploadedFile::fake()->create('voice-message.webm', 12, 'audio/webm');

        $response = app(MediaController::class)->upload($this->requestFor($file, 'message_voice'));
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame('audio', $payload['type']);
        $this->assertSame('audio/webm', $payload['mime']);

        $asset = DB::table('media_assets')->where('id', $payload['id'])->first();
        $this->assertSame('message_voice', $asset->purpose);
        $this->assertStringEndsWith('.webm', $asset->path);
        Storage::disk('public')->assertExists($asset->path);
    }

    public function test_voice_message_upload_accepts_ios_m4a_when_reported_as_octet_stream(): void
    {
        $file = UploadedFile::fake()->create('voice-message.m4a', 12, 'application/octet-stream');

        $response = app(MediaController::class)->upload($this->requestFor($file, 'message_voice'));
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame('audio', $payload['type']);
        $this->assertContains($payload['mime'], ['audio/x-m4a', 'audio/mp4']);

        $asset = DB::table('media_assets')->where('id', $payload['id'])->first();
        $this->assertStringEndsWith('.m4a', $asset->path);
        Storage::disk('public')->assertExists($asset->path);
    }

    private function requestFor(UploadedFile $file, string $purpose): Request
    {
        $request = Request::create('/api/v1/media', 'POST', ['purpose' => $purpose], [], ['file' => $file]);
        $user = new User();
        $user->forceFill(['id' => self::USER_ID]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
