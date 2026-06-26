<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MediaController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class MediaUploadHardeningTest extends TestCase
{
    private const USER_ID = '00000000-0000-4000-8000-000000000901';

    private const OTHER_USER_ID = '00000000-0000-4000-8000-000000000902';

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
            $table->string('user_id')->nullable();
            $table->string('disk');
            $table->string('path');
            $table->string('url');
            $table->string('mime')->nullable();
            $table->integer('size_bytes')->default(0);
            $table->integer('width')->nullable();
            $table->integer('height')->nullable();
            $table->string('purpose')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });

        DB::table('users')->insert(['id' => self::USER_ID]);
        DB::table('users')->insert(['id' => self::OTHER_USER_ID]);
        Storage::fake('public');
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('media_assets');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_real_image_upload_happy_path_returns_201(): void
    {
        if (! function_exists('imagejpeg')) {
            $this->markTestSkipped('GD extension is required for image uploads.');
        }

        $file = $this->realJpeg(20, 20);

        $response = app(MediaController::class)->upload($this->uploadRequest($file, 'general'));
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame('image', $payload['type']);
        $this->assertSame('image/jpeg', $payload['mime']);
        $this->assertSame(20, $payload['width']);
        $this->assertSame(20, $payload['height']);

        $asset = DB::table('media_assets')->where('id', $payload['id'])->first();
        $this->assertSame(self::USER_ID, $asset->user_id);
        Storage::disk('public')->assertExists($asset->path);
    }

    public function test_missing_file_is_rejected_with_422(): void
    {
        $request = Request::create('/api/v1/media', 'POST', ['purpose' => 'general']);
        $this->authenticate($request, self::USER_ID);

        $this->assertUploadRejected($request, 422);
    }

    public function test_unsupported_mime_is_rejected_with_422(): void
    {
        $file = UploadedFile::fake()->create('note.txt', 4, 'text/plain');

        $this->assertUploadRejected($this->uploadRequest($file, 'general'), 422);
    }

    public function test_audio_over_25mb_is_rejected_with_422(): void
    {
        // 26000 KB ~= 25.4MB, over the 25MB voice cap. Client mime marks it as
        // audio so it routes through the audio size cap (not the image branch).
        $file = UploadedFile::fake()->create('voice.webm', 26000, 'audio/webm');

        $this->assertUploadRejected($this->uploadRequest($file, 'message_voice'), 422);
    }

    public function test_video_over_50mb_is_rejected_with_422(): void
    {
        // 52000 KB ~= 50.8MB, over the 50MB video cap.
        $file = UploadedFile::fake()->create('clip.mp4', 52000, 'video/mp4');

        $this->assertUploadRejected($this->uploadRequest($file, 'general'), 422);
    }

    public function test_decompression_bomb_dimensions_are_rejected_with_422(): void
    {
        // A tiny PNG header that *declares* 30000x30000 (900 megapixels) but is
        // only a few bytes on disk. It passes the byte-size cap, so without the
        // dimension guard imagecreatefromstring() would attempt a ~3.6GB
        // allocation and OOM the worker.
        $png = "\x89PNG\r\n\x1a\n"
            .pack('N', 13).'IHDR'
            .pack('N', 30000).pack('N', 30000)
            ."\x08\x02\x00\x00\x00"
            .pack('N', 0);

        $path = tempnam(sys_get_temp_dir(), 'bomb').'.png';
        file_put_contents($path, $png);
        $file = new UploadedFile($path, 'bomb.png', 'image/png', null, true);

        $threw = false;
        try {
            app(MediaController::class)->upload($this->uploadRequest($file, 'general'));
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(422, $e->getStatusCode());
            $this->assertSame('Image dimensions are too large', $e->getMessage());
        } finally {
            @unlink($path);
        }
        $this->assertTrue($threw, 'Expected a 422 rejecting the oversized image dimensions');
    }

    public function test_delete_by_owner_soft_deletes_and_returns_204(): void
    {
        $id = $this->seedAsset(self::USER_ID);

        $request = Request::create('/api/v1/media/'.$id, 'DELETE');
        $this->authenticate($request, self::USER_ID);

        $response = app(MediaController::class)->delete($request, $id);

        $this->assertSame(204, $response->getStatusCode());
        $asset = DB::table('media_assets')->where('id', $id)->first();
        $this->assertNotNull($asset->deleted_at);
    }

    public function test_delete_other_users_asset_is_forbidden(): void
    {
        $id = $this->seedAsset(self::OTHER_USER_ID);

        $request = Request::create('/api/v1/media/'.$id, 'DELETE');
        $this->authenticate($request, self::USER_ID);

        $threw = false;
        try {
            app(MediaController::class)->delete($request, $id);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(403, $e->getStatusCode());
        }
        $this->assertTrue($threw, 'Expected a 403 for deleting another user\'s asset');

        $asset = DB::table('media_assets')->where('id', $id)->first();
        $this->assertNull($asset->deleted_at, 'Asset must not be soft-deleted by a non-owner');
    }

    public function test_delete_non_uuid_id_returns_404(): void
    {
        $request = Request::create('/api/v1/media/not-a-uuid', 'DELETE');
        $this->authenticate($request, self::USER_ID);

        $threw = false;
        try {
            app(MediaController::class)->delete($request, 'not-a-uuid');
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(404, $e->getStatusCode());
        }
        $this->assertTrue($threw, 'Expected a 404 for a non-uuid id');
    }

    public function test_delete_unknown_asset_returns_404(): void
    {
        $request = Request::create('/api/v1/media/'.Str::uuid(), 'DELETE');
        $this->authenticate($request, self::USER_ID);

        $threw = false;
        try {
            app(MediaController::class)->delete($request, (string) Str::uuid());
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(404, $e->getStatusCode());
        }
        $this->assertTrue($threw, 'Expected a 404 for an unknown asset');
    }

    private function seedAsset(string $ownerId): string
    {
        $id = (string) Str::uuid();
        DB::table('media_assets')->insert([
            'id' => $id,
            'user_id' => $ownerId,
            'disk' => 'public',
            'path' => 'uploads/2026/06/'.$id.'.jpg',
            'url' => 'https://example.test/uploads/'.$id.'.jpg',
            'mime' => 'image/jpeg',
            'size_bytes' => 1234,
            'width' => 10,
            'height' => 10,
            'purpose' => 'general',
            'deleted_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function realJpeg(int $width, int $height): UploadedFile
    {
        $image = imagecreatetruecolor($width, $height);
        $path = tempnam(sys_get_temp_dir(), 'img').'.jpg';
        imagejpeg($image, $path);
        imagedestroy($image);

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }

    private function uploadRequest(UploadedFile $file, string $purpose): Request
    {
        $request = Request::create('/api/v1/media', 'POST', ['purpose' => $purpose], [], ['file' => $file]);
        $this->authenticate($request, self::USER_ID);

        return $request;
    }

    private function authenticate(Request $request, string $userId): void
    {
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);
    }

    private function assertUploadRejected(Request $request, int $status): void
    {
        $threw = false;
        try {
            app(MediaController::class)->upload($request);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame($status, $e->getStatusCode());
        }
        $this->assertTrue($threw, 'Expected a '.$status.' rejecting the upload');
    }
}
