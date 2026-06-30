<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Http\Controllers\Api\Concerns\ValidatesMediaUrls;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class MediaController extends ApiController
{
    use AuthorizesAdminPermissions;
    use ValidatesMediaUrls;

    public function upload(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $file = $request->file('file');
        if ($file === null || ! $file->isValid()) {
            throw ApiException::validation("No file uploaded - expected multipart field 'file'");
        }
        $detectedMime = $this->normalizeMime((string) $file->getMimeType());
        $clientMime = $this->normalizeMime((string) $file->getClientMimeType());
        // Constrain the client-supplied purpose: it is persisted into the
        // media_assets.purpose string(64) column, so an over-long value would
        // raise a DB "value too long" error (500). Trim + cap to the column
        // width and fall back to the default for an empty value. The app only
        // sends short tokens (general, message_voice, avatar, …) so legitimate
        // input is never narrowed.
        $purpose = trim((string) $request->input('purpose', 'general'));
        if ($purpose === '') {
            $purpose = 'general';
        }
        $purpose = mb_substr($purpose, 0, 64);
        $isVoicePurpose = in_array($purpose, ['message_voice', 'voice', 'audio'], true);

        $audioMimes = ['audio/aac', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/m4a', 'audio/caf', 'audio/x-caf', 'audio/amr', 'audio/3gpp', 'application/ogg'];
        $videoMimes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'];
        $extensionMime = $this->mimeFromExtension((string) $file->getClientOriginalExtension());

        $isAudio = in_array($detectedMime, $audioMimes, true)
            || in_array($clientMime, $audioMimes, true)
            || ($isVoicePurpose && $extensionMime !== null && in_array($extensionMime, $audioMimes, true))
            || ($isVoicePurpose && $extensionMime === 'video/3gpp')
            || ($isVoicePurpose && in_array($detectedMime, ['video/webm', 'application/octet-stream'], true));
        $mime = $isAudio && in_array($clientMime, $audioMimes, true)
            ? $clientMime
            : (($isAudio && $extensionMime !== null && in_array($extensionMime, $audioMimes, true)) ? $extensionMime : (($isAudio && $isVoicePurpose && $extensionMime === 'video/3gpp') ? 'audio/3gpp' : $detectedMime));
        $isVideo = ! $isAudio && (in_array($mime, $videoMimes, true) || in_array($clientMime, $videoMimes, true) || ($extensionMime !== null && in_array($extensionMime, $videoMimes, true)));
        if ($isVideo && ! in_array($mime, $videoMimes, true)) {
            $mime = in_array($clientMime, $videoMimes, true) ? $clientMime : (string) $extensionMime;
        }
        $isImage = in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true);
        if (! $isVideo && ! $isImage && ! $isAudio) {
            throw ApiException::validation('Only jpeg, png, webp images, mp4/quicktime/webm videos and audio messages are allowed');
        }
        // Images stay capped at 8MB; voice notes at 25MB; videos at 50MB.
        $maxBytes = $isVideo ? 52428800 : ($isAudio ? 25 * 1024 * 1024 : 8 * 1024 * 1024);
        if ($file->getSize() > $maxBytes) {
            throw ApiException::validation('File is too large');
        }

        // Chat images/videos/voice notes are private: stored on a NON-public
        // disk and served only through the signed media.serve route. Everything
        // else (avatars use their own endpoint) keeps a direct public URL.
        $isPrivate = in_array($purpose, (array) config('media.private_purposes', []), true);
        $disk = $isPrivate
            ? (string) config('media.private_disk', 'local')
            : env('MEDIA_DISK', config('filesystems.default') === 's3' ? 's3' : 'public');

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
                'audio/mp4', 'audio/x-m4a', 'audio/m4a' => 'm4a',
                'audio/ogg', 'application/ogg' => 'ogg',
                'audio/wav' => 'wav',
                'audio/webm' => 'webm',
                'audio/caf', 'audio/x-caf' => 'caf',
                'audio/amr' => 'amr',
                'audio/3gpp' => '3gp',
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
            // Decompression-bomb guard: getimagesize() reports the declared
            // dimensions cheaply from the header, but compressedImage() below
            // calls imagecreatefromstring() which allocates ~4 bytes per pixel
            // for the full source bitmap. A tiny (<=8MB) file can still declare
            // enormous dimensions and OOM the PHP-FPM worker. Any genuine photo
            // at this pixel count would already exceed the 8MB image cap above,
            // so legitimate uploads are never narrowed.
            if ($width < 1 || $height < 1 || ($width * $height) > 100000000) {
                throw ApiException::validation('Image dimensions are too large');
            }
            $extension = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
            [$contents, $width, $height] = $this->compressedImage($file->getRealPath(), $mime, $width, $height);
        }

        $path = 'uploads/'.now()->format('Y/m').'/'.Str::uuid().'.'.$extension;
        // Fail loudly if the write doesn't land (e.g. storage not writable by the
        // PHP-FPM user) — otherwise we'd return 201 with a URL that 404s and the
        // attachment silently never appears.
        $stored = Storage::disk($disk)->put($path, $contents, ['visibility' => $isPrivate ? 'private' : 'public']);
        if ($stored === false || ! Storage::disk($disk)->exists($path)) {
            throw ApiException::internal('Failed to store the uploaded file');
        }
        $id = (string) Str::uuid();
        // Private media: store the STABLE canonical serve route as the asset URL
        // (re-signed fresh on every read by presentMediaUrl) and hand the caller
        // a signed URL now for immediate preview. Public media keeps its direct
        // disk URL.
        $canonicalUrl = $isPrivate ? url('/api/v1/media/'.$id) : Storage::disk($disk)->url($path);
        $url = $isPrivate ? $this->signedMediaServeUrl($id) : $canonicalUrl;
        DB::table('media_assets')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'disk' => $disk,
            'path' => $path,
            'url' => $canonicalUrl,
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

    /**
     * Stream a media asset. Reachable ONLY with a valid temporary signature
     * (the 'signed' middleware) — the message serializers mint one fresh for
     * viewers already authorised to read the attachment, so private chat media
     * is no longer a permanent, world-readable URL.
     */
    public function serve(Request $request, string $media): StreamedResponse
    {
        $asset = DB::table('media_assets')->where('id', $media)->first(['disk', 'path', 'mime', 'deleted_at']);
        if ($asset === null || ($asset->deleted_at ?? null) !== null) {
            throw ApiException::notFound('Media not found');
        }
        $disk = Storage::disk((string) $asset->disk);
        if (! $disk->exists((string) $asset->path)) {
            throw ApiException::notFound('Media not found');
        }

        return $disk->response((string) $asset->path, basename((string) $asset->path), [
            'Content-Type' => (string) ($asset->mime ?: 'application/octet-stream'),
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }

    private function normalizeMime(string $mime): string
    {
        return strtolower(trim(explode(';', $mime)[0] ?? ''));
    }

    private function mimeFromExtension(string $extension): ?string
    {
        return match (strtolower(trim($extension))) {
            'aac' => 'audio/aac',
            'mp3' => 'audio/mpeg',
            'm4a' => 'audio/x-m4a',
            'caf' => 'audio/x-caf',
            'amr' => 'audio/amr',
            'ogg', 'oga' => 'audio/ogg',
            'wav' => 'audio/wav',
            'webm' => 'audio/webm',
            '3gp', '3gpp' => 'video/3gpp',
            'mp4' => 'video/mp4',
            'mov' => 'video/quicktime',
            default => null,
        };
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
        // The id maps to the media_assets.id uuid column; a non-uuid route value
        // would raise a Postgres invalid-text-representation error (surfacing as a
        // generic 500) instead of the intended 404. Reject it up front.
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Media asset not found');
        }
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
