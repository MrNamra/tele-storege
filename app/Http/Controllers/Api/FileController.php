<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\FileRequest;
use App\Interfaces\FileRepositoryInterface;
use App\Models\Bucket;
use App\Services\Telegram\TelegramClient;
use App\Trait\ApiResponseTrait;
use Exception;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpKernel\Exception\HttpException;

class FileController extends Controller
{
    use ApiResponseTrait;

    protected $fileRepo;

    public function __construct(FileRepositoryInterface $fileRepo)
    {
        $this->fileRepo = $fileRepo;
    }

    public function uploadFile(FileRequest $request): JsonResponse
    {
        try {
            $bucket = Bucket::firstWhere(['user_id' => auth()->id(), 'id' => $request->bucket_id]);

            if (! $bucket) {
                return self::errorResponse('Bucket not found / Selected');
            }

            $data = $this->fileRepo->fileUpload($request->file('files'), $bucket);

            return $data[0]['uploaded'] ?
                    self::successResponse(message: 'file(s) uplaoded successfully', data: $data) :
                    self::errorResponse(message: 'File Uplaod Failed');

        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function showBucketData(Request $request, Bucket $bucket): JsonResponse
    {
        try {
            $result = $this->fileRepo->bucketData($request->all(), $bucket);

            if (isset($result['files']) && isset($result['pagination'])) {
                return self::successResponse(
                    data: $result['files'],
                    pagination: $result['pagination'],
                    totalStorage: $result['totalStorage'] ?? 0
                );
            }

            return self::successResponse(data: $result);
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function streamThumb(Bucket $bucket, int $messageId)
    {
        try {

            return $this->fileRepo->streamThumbnail($bucket, $messageId);

        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function authorizeBucketAccess(Bucket $bucket, Request $request): bool
    {
        // 1. Shared bucket: no authentication required!
        if ($bucket->bucketShare()->exists()) {
            return true;
        }

        // 2. Private bucket: authenticated user must be the bucket owner
        $user = $request->user('sanctum');
        if (! $user && $request->filled('token')) {
            $tokenModel = PersonalAccessToken::findToken($request->query('token'));
            if ($tokenModel) {
                $user = $tokenModel->tokenable;
            }
        }

        if ($user && (int) $bucket->user_id === (int) $user->id) {
            return true;
        }

        // 3. Compact HMAC signed media token for this bucket (zero DB, tamper-proof!)
        $fileId = $request->route('id') ?? $request->query('file_id') ?? $request->input('file_id');
        if ($fileId && isCompactSignedIdForBucket((string) $fileId, $bucket->id)) {
            return true;
        }

        return false;
    }

    public function thumbnail(Request $request, TelegramClient $telegram, Bucket $bucket, $id)
    {
        if ($request->isMethod('OPTIONS')) {
            return response('', 204, [
                'Access-Control-Allow-Origin' => '*',
                'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers' => 'Range, Authorization, Content-Type, Origin, Accept',
                'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                'Access-Control-Max-Age' => '86400',
            ]);
        }

        if (! $this->authorizeBucketAccess($bucket, $request)) {
            abort(403, 'Unauthorized access to bucket');
        }

        $msgId = safeDecryptId($id) ?? (is_numeric($id) ? (int) $id : decrypt($id));
        if (! $msgId) {
            abort(404, 'Invalid thumbnail ID');
        }

        return $telegram->streamThumbnail(channelId: $bucket->channel_id, msgId: $msgId);
    }

    public function stream(Request $request, TelegramClient $telegram, Bucket $bucket, $id)
    {
        return $this->streamFileSigned($request, $telegram, $bucket, $id);
    }

    public function removeFile(Request $request, Bucket $bucket)
    {
        $request->validate([
            'file_id' => 'required|array',
            'file_id.*' => 'required',
        ]);

        try {
            if ($bucket->user_id !== Auth::id()) {
                return self::errorResponse(message: 'Bucket or File not found');
            }

            $this->fileRepo->deleteFiles(
                channel_id: $bucket->channel_id,
                IDs: $request->file_id
            );

            return self::successResponse(message: 'File(s) Deleted Successfully');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function downlaodFile(FileRequest $request)
    {
        return $this->downloadFile($request);
    }

    public function downloadFile(Request $request, $bucketId = null, $fileId = null)
    {
        if ($request->isMethod('OPTIONS')) {
            return response('', 204, [
                'Access-Control-Allow-Origin' => '*',
                'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers' => 'Range, Authorization, Content-Type, Origin, Accept',
                'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                'Access-Control-Max-Age' => '86400',
            ]);
        }

        try {
            $bId = $bucketId ?? $request->input('bucket_id') ?? $request->query('bucket_id');
            $fId = $fileId ?? $request->input('file_id') ?? $request->query('file_id');

            if (! $bId || ! $fId) {
                return self::errorResponse(message: 'bucket_id and file_id are required', status: 422);
            }

            $bucket = Bucket::find($bId);
            if (! $bucket) {
                return self::errorResponse(message: 'Bucket not found', status: 404);
            }

            if (! $this->authorizeBucketAccess($bucket, $request)) {
                return self::errorResponse(message: 'Access denied to bucket', status: 403);
            }

            return $this->fileRepo->fileDownload($fId, $bucket->channel_id);

        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function streamFile(Request $request, TelegramClient $telegram)
    {
        try {
            $request->validate([
                'file_id' => 'required|string',
                'bucket_id' => 'required|exists:buckets,id',
            ]);

            $bucket = Bucket::firstWhere(['id' => $request->bucket_id]);

            if (! $bucket || ! $this->authorizeBucketAccess($bucket, $request)) {
                return self::errorResponse(message: 'Bucket not found or access denied');
            }

            $msgId = safeDecryptId($request->file_id) ?? (is_numeric($request->file_id) ? (int) $request->file_id : decrypt($request->file_id));

            return $this->streamFileSigned($request, $telegram, $bucket, (string) $msgId);

        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function streamFileSigned(Request $request, TelegramClient $telegram, Bucket $bucket, $id)
    {
        if ($request->isMethod('OPTIONS')) {
            return response('', 204, [
                'Access-Control-Allow-Origin' => '*',
                'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers' => 'Range, Authorization, Content-Type, Origin, Accept',
                'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                'Access-Control-Max-Age' => '86400',
            ]);
        }

        try {
            if (! $this->authorizeBucketAccess($bucket, $request)) {
                abort(403, 'Unauthorized access to bucket');
            }

            $msgId = safeDecryptId($id) ?? (is_numeric($id) ? (int) $id : decrypt($id));

            if (! $msgId) {
                Log::error('Invalid file ID for stream: '.$id);
                abort(404, 'Invalid file ID');
            }

            $history = null;
            try {
                $history = $telegram->client()->messages->getHistory(
                    peer: $bucket->channel_id,
                    offset_id: $msgId + 1,
                    limit: 1
                );
            } catch (\Throwable $e) {
                Log::warning('getHistory failed in streamFileSigned: '.$e->getMessage());
            }

            $message = $history['messages'][0] ?? null;

            if (! $message || empty($message['media'])) {
                $result = $telegram->client()->messages->getMessages([
                    'peer' => $bucket->channel_id,
                    'id' => [$msgId],
                ]);
                $message = $result['messages'][0] ?? null;
            }

            if (! $message || empty($message['media'])) {
                abort(404, 'File not found');
            }

            $media = $message['media'];

            // Detect mime type and filename
            $isHeic = false;
            $fileSize = 0;
            if (isset($media['photo'])) {
                $mime = 'image/jpeg';
                $filename = 'photo_'.$msgId.'.jpg';
                $fileSize = (int) ($media['photo']['size'] ?? 0);
            } elseif (isset($media['document'])) {
                $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
                $filename = 'file_'.$msgId;
                $fileSize = (int) ($media['document']['size'] ?? 0);
                foreach ($media['document']['attributes'] ?? [] as $attr) {
                    if ($attr['_'] === 'documentAttributeFilename') {
                        $filename = $attr['file_name'];
                        break;
                    }
                }
                $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
                if ($ext === 'heic' || $ext === 'heif' || $mime === 'image/heic' || $mime === 'image/heif') {
                    $isHeic = true;
                }
            } else {
                abort(404, 'Unsupported media type');
            }

            // If HEIC, convert to JPEG for universal browser preview (Chrome/Firefox/etc.)
            if ($isHeic) {
                TelegramClient::scheduleShutdownPrune();
                $cleanChannel = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $bucket->channel_id);
                $heicCacheDir = storage_path('app/heic_cache');
                if (! is_dir($heicCacheDir)) {
                    @mkdir($heicCacheDir, 0775, true);
                }
                $cachedJpeg = "{$heicCacheDir}/heic_{$cleanChannel}_{$msgId}.jpg";
                $ttl = (int) config('services.telegram.cache_ttl', 7200);

                if (file_exists($cachedJpeg) && filesize($cachedJpeg) > 0) {
                    if ((time() - filemtime($cachedJpeg)) > $ttl) {
                        @unlink($cachedJpeg);
                    }
                }

                if (! file_exists($cachedJpeg) || filesize($cachedJpeg) === 0) {
                    $tempHeic = tempnam(sys_get_temp_dir(), 'tg_heic_');
                    $outStream = fopen($tempHeic, 'wb');
                    $telegram->client()->downloadToStream($media, $outStream);
                    fclose($outStream);

                    convertHeicToJpeg($tempHeic, $cachedJpeg, 0.9);
                    if (file_exists($tempHeic)) {
                        @unlink($tempHeic);
                    }
                }

                if (file_exists($cachedJpeg) && filesize($cachedJpeg) > 0) {
                    return response()->file($cachedJpeg, [
                        'Content-Type' => 'image/jpeg',
                        'Content-Disposition' => 'inline; filename="'.pathinfo($filename, PATHINFO_FILENAME).'.jpg"',
                        'Cache-Control' => 'public, max-age='.$ttl,
                        'Access-Control-Allow-Origin' => '*',
                    ]);
                }
            }

            // If Video or Audio, check if pre-converted cached MP4 exists on disk
            $ext = $ext ?? '';
            $isVideo = str_starts_with($mime, 'video/') || in_array($ext, ['mov', 'mp4', 'm4v', 'mkv', 'webm', 'avi', '3gp', 'flv', 'wmv']);
            $isAudio = str_starts_with($mime, 'audio/') || in_array($ext, ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac', 'opus']);

            if ($isVideo) {
                TelegramClient::scheduleShutdownPrune();
                $cleanChannel = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $bucket->channel_id);
                $videoCacheDir = storage_path('app/video_cache');
                $cachedMp4 = "{$videoCacheDir}/video_{$cleanChannel}_{$msgId}.mp4";
                $ttl = (int) config('services.telegram.cache_ttl', 7200);

                if (file_exists($cachedMp4) && filesize($cachedMp4) > 0) {
                    if ((time() - filemtime($cachedMp4)) > $ttl) {
                        @unlink($cachedMp4);
                    } else {
                        return response()->file($cachedMp4, [
                            'Content-Type' => 'video/mp4',
                            'Content-Disposition' => 'inline; filename="'.pathinfo($filename, PATHINFO_FILENAME).'.mp4"',
                            'Cache-Control' => 'public, max-age='.$ttl,
                            'Accept-Ranges' => 'bytes',
                            'Access-Control-Allow-Origin' => '*',
                            'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                            'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                        ]);
                    }
                }
            }

            // Support HEAD requests for media probing
            if ($request->isMethod('HEAD')) {
                $headHeaders = [
                    'Content-Type' => $mime,
                    'Content-Disposition' => 'inline; filename="'.addcslashes($filename, '"').'"',
                    'Accept-Ranges' => 'bytes',
                    'Cache-Control' => 'public, max-age=86400',
                    'Access-Control-Allow-Origin' => '*',
                    'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                    'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                ];
                if ($fileSize > 0) {
                    $headHeaders['Content-Length'] = (string) $fileSize;
                }

                return response('', 200, $headHeaders);
            }

            // HTTP 206 Partial Content (Byte-Range) streaming directly from Telegram
            // Streams in small chunks on demand so there is no need to download the full video to disk
            $rangeHeader = $request->header('Range');
            if ($rangeHeader && preg_match('/bytes=\s*(\d*)\s*-\s*(\d*)/i', $rangeHeader, $matches)) {
                $startStr = $matches[1];
                $endStr = $matches[2];

                if ($startStr === '' && $endStr !== '') {
                    // Suffix range: bytes=-524288 (last 512KB, used to read MP4 moov metadata if at end of file)
                    $suffix = (int) $endStr;
                    $start = $fileSize > 0 ? max(0, $fileSize - $suffix) : 0;
                    $end = $fileSize > 0 ? $fileSize - 1 : 0;
                } elseif ($startStr !== '' && $endStr === '') {
                    // Open-ended range: bytes=0- or bytes=1048576-
                    // Stream in small chunk window so it starts instantly without downloading the whole file
                    $start = (int) $startStr;
                    $chunkSize = 2 * 1024 * 1024; // 2MB chunk window (fast, smooth buffer)
                    $end = $fileSize > 0 ? min($fileSize - 1, $start + $chunkSize - 1) : $start + $chunkSize - 1;
                } elseif ($startStr !== '' && $endStr !== '') {
                    // Specific range: bytes=0-1048575 or bytes=0-1
                    $start = (int) $startStr;
                    $requestedEnd = (int) $endStr;
                    $end = $fileSize > 0
                        ? min($fileSize - 1, $requestedEnd)
                        : $requestedEnd;
                } else {
                    $start = 0;
                    $chunkSize = 2 * 1024 * 1024;
                    $end = $fileSize > 0 ? min($fileSize - 1, $chunkSize - 1) : $chunkSize - 1;
                }

                if ($fileSize > 0 && $start >= $fileSize) {
                    return response('', 416, [
                        'Content-Range' => "bytes */{$fileSize}",
                        'Accept-Ranges' => 'bytes',
                        'Access-Control-Allow-Origin' => '*',
                    ]);
                }

                $length = ($end - $start) + 1;
                $telegramEnd = $end + 1; // MadelineProto uses exclusive end offset

                $headers = [
                    'Content-Type' => $mime,
                    'Content-Disposition' => 'inline; filename="'.addcslashes($filename, '"').'"',
                    'Content-Range' => "bytes {$start}-{$end}/".($fileSize > 0 ? $fileSize : '*'),
                    'Content-Length' => (string) $length,
                    'Accept-Ranges' => 'bytes',
                    'Cache-Control' => 'public, max-age=86400',
                    'X-Content-Type-Options' => 'nosniff',
                    'Access-Control-Allow-Origin' => '*',
                    'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                    'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                ];

                return response()->stream(function () use ($telegram, $media, $start, $telegramEnd) {
                    @set_time_limit(180);
                    @ignore_user_abort(false);
                    if (session_status() === PHP_SESSION_ACTIVE) {
                        @session_write_close();
                    }
                    $out = fopen('php://output', 'wb');
                    $onProgress = function () {
                        if (connection_aborted()) {
                            throw new \RuntimeException('Client disconnected');
                        }
                    };
                    try {
                        $telegram->client()->downloadToStream($media, $out, $onProgress, $start, $telegramEnd);
                    } catch (\Throwable $e) {
                        Log::debug('Stream range chunk interrupted: '.$e->getMessage());
                    } finally {
                        if (is_resource($out)) {
                            @fclose($out);
                        }
                    }
                }, 206, $headers);
            }

            $headers = [
                'Content-Type' => $mime,
                'Content-Disposition' => 'inline; filename="'.addcslashes($filename, '"').'"',
                'Accept-Ranges' => 'bytes',
                'Cache-Control' => 'public, max-age=86400',
                'X-Content-Type-Options' => 'nosniff',
                'Access-Control-Allow-Origin' => '*',
                'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
                'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
            ];

            if ($fileSize > 0) {
                $headers['Content-Length'] = (string) $fileSize;
            }

            return response()->stream(function () use ($telegram, $media) {
                @set_time_limit(600);
                @ignore_user_abort(false);
                if (session_status() === PHP_SESSION_ACTIVE) {
                    @session_write_close();
                }
                $out = fopen('php://output', 'wb');
                $onProgress = function () {
                    if (connection_aborted()) {
                        throw new \RuntimeException('Client disconnected');
                    }
                };
                try {
                    $telegram->client()->downloadToStream($media, $out, $onProgress);
                } catch (\Throwable $e) {
                    Log::debug('Full stream interrupted: '.$e->getMessage());
                } finally {
                    if (is_resource($out)) {
                        @fclose($out);
                    }
                }
            }, 200, $headers);

        } catch (HttpException $e) {
            throw $e;
        } catch (DecryptException $e) {
            Log::error('Decrypt error for stream: '.$e->getMessage());
            abort(404, 'Invalid file ID');
        } catch (ModelNotFoundException $e) {
            Log::error('Bucket not found for stream: '.$e->getMessage());
            abort(404, 'Bucket not found');
        } catch (\Throwable $e) {
            Log::error('Stream file error: '.$e->getMessage());
            abort(404, 'File not found');
        }
    }
}
