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
        $detectedMime = $this->normalizeMime((string) $file->getMimeType());
        $clientMime = $this->normalizeMime((string) $file->getClientMimeType());
        $purpose = (string) $request->input('purpose', 'general');
        $isVoicePurpose = in_array($purpose, ['message_voice', 'voice', 'audio'], true);

        $audioMimes = ['audio/aac', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'application/ogg'];
        $videoMimes = ['video/mp4', 'video/quicktime', 'video/webm'];

        $isAudio = in_array($detectedMime, $audioMimes, true)
            || in_array($clientMime, $audioMimes, true)
            || ($isVoicePurpose && in_array($detectedMime, ['video/webm', 'application/octet-stream'], true));
        $mime = $isAudio && in_array($clientMime, $audioMimes, true) ? $clientMime : $detectedMime;
        $isVideo = ! $isAudio && in_array($mime, $videoMimes, true);
        $isImage = in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true);
        if (! $isVideo && ! $isImage && ! $isAudio) {
            throw ApiException::validation('Only jpeg, png, webp images, mp4/quicktime/webm videos and audio messages are allowed');
        }
        // Images stay capped at 8MB; voice notes at 25MB; videos at 50MB.
        $maxBytes = $isVideo ? 52428800 : ($isAudio ? 25 * 1024 * 1024 : 8 * 1024 * 1024);
        if ($file->getSize() > $maxBytes) {
            throw ApiException::validation('File is too large');
        }

        $disk = env('MEDIA_DISK', config('filesystems.default') === 's3' ? 's3' : 'public');

        if ($isVideo || $isAudio) {
            // Binary media skips image-compression entirely so playback stays
            // unmodified for videos and voice notes.
            $type = $isAudio ? 'audio' : 'video';
            $width = null;
            $height = null;
            $extension = match ($mime) {
                'video/quicktime' => 'mov',
                'video/webm' => 'webm',
                'audio/aac' => 'aac',
                'audio/mpeg' => 'mp3',
                'audio/mp4', 'audio/x-m4a' => 'm4a',
                'audio/ogg', 'application/ogg' => 'ogg',
                'audio/wav' => 'wav',
                'audio/webm' => 'webm',
                default => 'mp4',
            };
            $contents = (string) file_get_contents($file->getRealPath());
        } else {
            $type = 'image';
            $info = @getimagesize($file->getRealPath());
            if ($info === false) {
                throw ApiException::validation('Invalid image file');
            }
            [$width, $height] = $info;
            $extension = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
            [$contents, $width, $height] = $this->compressedImage($file->getRealPath(), $mime, $width, $height);
        }

        $path = 'uploads/'.now()->format('Y/m').'/'.Str::uuid().'.'.$extension;
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

        return response()->json(['id' => $id, 'url' => $url, 'type' => $type, 'width' => $width, 'height' => $height, 'mime' => $mime], 201);
    }

    private function normalizeMime(string $mime): string
    {
        return strtolower(trim(explode(';', $mime)[0] ?? ''));
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
