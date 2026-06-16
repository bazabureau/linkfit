<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MediaController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function upload(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $file = $request->file('file');
        if ($file === null || ! $file->isValid()) {
            throw ApiException::validation("No file uploaded - expected multipart field 'file'");
        }
        if ($file->getSize() > 8 * 1024 * 1024) {
            throw ApiException::validation('File is too large');
        }
        $mime = (string) $file->getMimeType();
        if (! in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw ApiException::validation('Only jpeg, png and webp images are allowed');
        }
        $info = @getimagesize($file->getRealPath());
        if ($info === false) {
            throw ApiException::validation('Invalid image file');
        }
        [$width, $height] = $info;
        $disk = env('MEDIA_DISK', config('filesystems.default') === 's3' ? 's3' : 'public');
        $purpose = (string) $request->input('purpose', 'general');
        $extension = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
        $path = 'uploads/'.now()->format('Y/m').'/'.Str::uuid().'.'.$extension;
        [$contents, $width, $height] = $this->compressedImage($file->getRealPath(), $mime, $width, $height);
        Storage::disk($disk)->put($path, $contents, ['visibility' => 'public']);
        $url = Storage::disk($disk)->url($path);
        $id = (string) Str::uuid();
        DB::table('media_assets')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'disk' => $disk,
            'path' => $path,
            'url' => $url,
            'mime' => $mime,
            'size_bytes' => strlen($contents),
            'width' => $width,
            'height' => $height,
            'purpose' => $purpose,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json(['id' => $id, 'url' => $url, 'width' => $width, 'height' => $height, 'mime' => $mime], 201);
    }

    /**
     * @return array{0:string,1:int,2:int}
     */
    private function compressedImage(string $path, string $mime, int $width, int $height): array
    {
        if (! function_exists('imagecreatefromstring')) {
            return [(string) file_get_contents($path), $width, $height];
        }

        $source = @imagecreatefromstring((string) file_get_contents($path));
        if ($source === false) {
            throw ApiException::validation('Invalid image file');
        }

        $maxDimension = 2200;
        $ratio = min(1, $maxDimension / max($width, $height));
        $targetWidth = max(1, (int) round($width * $ratio));
        $targetHeight = max(1, (int) round($height * $ratio));
        $image = $source;

        if ($targetWidth !== $width || $targetHeight !== $height) {
            $image = imagecreatetruecolor($targetWidth, $targetHeight);
            if (in_array($mime, ['image/png', 'image/webp'], true)) {
                imagealphablending($image, false);
                imagesavealpha($image, true);
                $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
                imagefilledrectangle($image, 0, 0, $targetWidth, $targetHeight, $transparent);
            }
            imagecopyresampled($image, $source, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
            imagedestroy($source);
        }

        ob_start();
        if ($mime === 'image/png') {
            imagepng($image, null, 8);
        } elseif ($mime === 'image/webp' && function_exists('imagewebp')) {
            imagewebp($image, null, 82);
        } else {
            imageinterlace($image, true);
            imagejpeg($image, null, 84);
        }
        $contents = (string) ob_get_clean();
        imagedestroy($image);

        return [$contents, $targetWidth, $targetHeight];
    }

    public function delete(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $asset = DB::table('media_assets')->where('id', $id)->first();
        if ($asset === null || $asset->deleted_at !== null) {
            throw ApiException::notFound('Media asset not found');
        }
        $adminAction = $asset->user_id !== $user->id;
        if ($adminAction) {
            $this->requireAdminPermission($request, 'media');
        }
        Storage::disk($asset->disk)->delete($asset->path);
        DB::table('media_assets')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        if ($adminAction) {
            $this->auditWrite($user->id, 'media.delete', 'media_assets', $id, [
                'asset_user_id' => $asset->user_id,
                'disk' => $asset->disk,
                'path' => $asset->path,
            ]);
        }

        return response()->json(null, 204);
    }

    private function auditWrite(?string $actorUserId, string $action, string $entity, ?string $entityId = null, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }
}
