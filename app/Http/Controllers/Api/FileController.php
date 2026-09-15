<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\FileRequest;
use App\Interfaces\FileRepositoryInterface;
use App\Models\Bucket;
use App\Trait\ApiResponseTrait;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Services\Telegram\TelegramClient;
use Exception;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

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

            if(!$bucket) {
                return Self::errorResponse('Bucket not found / Selected');
            }

            $data = $this->fileRepo->fileUpload($request->file('files'), $bucket);

            return $data[0]['uploaded'] ?
                    Self::successResponse(message:'file(s) uplaoded successfully', data: $data) :
                    Self::errorResponse(message:'File Uplaod Failed');

        } catch (\Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function showBucketData(Request $request, Bucket $bucket): JsonResponse
    {
        try {
            $result = $this->fileRepo->bucketData($request->all(), $bucket);

            if (isset($result['files']) && isset($result['pagination'])) {
                return Self::successResponse(
                    data: $result['files'],
                    pagination: $result['pagination'],
                    totalStorage: $result['totalStorage'] ?? 0
                );
            }

            return Self::successResponse(data: $result);
        } catch (\Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function streamThumb(Bucket $bucket, int $messageId)
    {
        try {

            return $this->fileRepo->streamThumbnail($bucket, $messageId);

        } catch (\Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
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
        if (!$user && $request->filled('token')) {
            $tokenModel = \Laravel\Sanctum\PersonalAccessToken::findToken($request->query('token'));
            if ($tokenModel) {
                $user = $tokenModel->tokenable;
            }
        }

        if ($user && (int)$bucket->user_id === (int)$user->id) {
            return true;
        }

        return false;
    }

    public function thumbnail(Request $request, TelegramClient $telegram, Bucket $bucket, $id)
    {
        if (!$this->authorizeBucketAccess($bucket, $request)) {
            abort(403, 'Unauthorized access to bucket');
        }

        $msgId = safeDecryptId($id) ?? (is_numeric($id) ? (int)$id : decrypt($id));
        if (!$msgId) {
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
            'file_id'=> 'required|array',
            'file_id.*' => 'required'
        ]);

        try {
            if ($bucket->user_id !== Auth::id()) {
                return Self::errorResponse(message:'Bucket or File not found');
            }

            $this->fileRepo->deleteFiles(
                channel_id: $bucket->channel_id,
                IDs: $request->file_id
            );

            return Self::successResponse(message: 'File(s) Deleted Successfully');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function downlaodFile(FileRequest $request)
    {
        return $this->downloadFile($request);
    }

    public function downloadFile(Request $request, $bucketId = null, $fileId = null)
    {
        try {
            $bId = $bucketId ?? $request->input('bucket_id') ?? $request->query('bucket_id');
            $fId = $fileId ?? $request->input('file_id') ?? $request->query('file_id');

            if (!$bId || !$fId) {
                return Self::errorResponse(message: 'bucket_id and file_id are required', status: 422);
            }

            $bucket = Bucket::find($bId);
            if (!$bucket) {
                return Self::errorResponse(message: 'Bucket not found', status: 404);
            }

            if (!$this->authorizeBucketAccess($bucket, $request)) {
                return Self::errorResponse(message: 'Access denied to bucket', status: 403);
            }

            return $this->fileRepo->fileDownload($fId, $bucket->channel_id);

        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
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

            if(!$bucket || !$this->authorizeBucketAccess($bucket, $request)) {
                return Self::errorResponse(message: 'Bucket not found or access denied');
            }

            $msgId = safeDecryptId($request->file_id) ?? (is_numeric($request->file_id) ? (int)$request->file_id : decrypt($request->file_id));

            return $this->streamFileSigned($request, $telegram, $bucket, (string)$msgId);

        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function streamFileSigned(Request $request, TelegramClient $telegram, Bucket $bucket, $id)
    {
        try {
            if (!$this->authorizeBucketAccess($bucket, $request)) {
                abort(403, 'Unauthorized access to bucket');
            }

            $msgId = safeDecryptId($id) ?? (is_numeric($id) ? (int)$id : decrypt($id));

            if (!$msgId) {
                Log::error('Invalid file ID for stream: ' . $id);
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
                Log::warning('getHistory failed in streamFileSigned: ' . $e->getMessage());
            }

            $message = $history['messages'][0] ?? null;

            if (!$message || empty($message['media'])) {
                $result = $telegram->client()->messages->getMessages([
                    'peer' => $bucket->channel_id,
                    'id'   => [$msgId],
                ]);
                $message = $result['messages'][0] ?? null;
            }

            if (!$message || empty($message['media'])) {
                abort(404, 'File not found');
            }

            $media = $message['media'];

            // Detect mime type and filename
            $isHeic = false;
            if (isset($media['photo'])) {
                $mime = 'image/jpeg';
                $filename = 'photo_' . $msgId . '.jpg';
            } elseif (isset($media['document'])) {
                $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
                $filename = 'file_' . $msgId;
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
                \App\Services\Telegram\TelegramClient::scheduleShutdownPrune();
                $cleanChannel = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$bucket->channel_id);
                $heicCacheDir = storage_path('app/heic_cache');
                if (!is_dir($heicCacheDir)) {
                    @mkdir($heicCacheDir, 0775, true);
                }
                $cachedJpeg = "{$heicCacheDir}/heic_{$cleanChannel}_{$msgId}.jpg";
                $ttl = (int)config('services.telegram.cache_ttl', 7200);

                if (file_exists($cachedJpeg) && filesize($cachedJpeg) > 0) {
                    if ((time() - filemtime($cachedJpeg)) > $ttl) {
                        @unlink($cachedJpeg);
                    }
                }

                if (!file_exists($cachedJpeg) || filesize($cachedJpeg) === 0) {
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
                        'Content-Type'        => 'image/jpeg',
                        'Content-Disposition' => 'inline; filename="' . pathinfo($filename, PATHINFO_FILENAME) . '.jpg"',
                        'Cache-Control'       => 'public, max-age=' . $ttl,
                        'Access-Control-Allow-Origin' => '*',
                    ]);
                }
            }

            // If Video (MOV, MP4, MKV, etc.), convert to faststart MP4 and serve with HTTP 206 Range support
            $ext = $ext ?? '';
            $isVideo = str_starts_with($mime, 'video/') || in_array($ext, ['mov', 'mp4', 'm4v', 'mkv', 'webm', 'avi', '3gp', 'flv', 'wmv']);
            if ($isVideo) {
                \App\Services\Telegram\TelegramClient::scheduleShutdownPrune();
                $cleanChannel = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$bucket->channel_id);
                $videoCacheDir = storage_path('app/video_cache');
                if (!is_dir($videoCacheDir)) {
                    @mkdir($videoCacheDir, 0775, true);
                }
                $cachedMp4 = "{$videoCacheDir}/video_{$cleanChannel}_{$msgId}.mp4";
                $ttl = (int)config('services.telegram.cache_ttl', 7200);

                if (file_exists($cachedMp4) && filesize($cachedMp4) > 0) {
                    if ((time() - filemtime($cachedMp4)) > $ttl) {
                        @unlink($cachedMp4);
                    }
                }

                if (!file_exists($cachedMp4) || filesize($cachedMp4) === 0) {
                    $lockFile = "{$cachedMp4}.lock";
                    $lockFp = fopen($lockFile, 'c+');
                    if ($lockFp) {
                        @flock($lockFp, LOCK_EX);
                        try {
                            // Double-check if another process completed the conversion while we waited
                            if (!file_exists($cachedMp4) || filesize($cachedMp4) === 0) {
                                @set_time_limit(600);
                                @ignore_user_abort(true);

                                $tempRaw = tempnam(sys_get_temp_dir(), 'tg_video_') . ($ext ? '.' . $ext : '');
                                $outStream = fopen($tempRaw, 'wb');
                                $telegram->client()->downloadToStream($media, $outStream);
                                fclose($outStream);

                                $tempTarget = "{$cachedMp4}.tmp." . uniqid() . ".mp4";
                                if (convertVideoToMp4($tempRaw, $tempTarget) && file_exists($tempTarget) && filesize($tempTarget) > 0) {
                                    @rename($tempTarget, $cachedMp4);
                                } else {
                                    @rename($tempRaw, $cachedMp4);
                                }

                                if (file_exists($tempRaw)) {
                                    @unlink($tempRaw);
                                }
                                if (file_exists($tempTarget)) {
                                    @unlink($tempTarget);
                                }
                            }
                        } finally {
                            @flock($lockFp, LOCK_UN);
                            @fclose($lockFp);
                            @unlink($lockFile);
                        }
                    }
                }

                if (file_exists($cachedMp4) && filesize($cachedMp4) > 0) {
                    return response()->file($cachedMp4, [
                        'Content-Type'                  => 'video/mp4',
                        'Content-Disposition'           => 'inline; filename="' . pathinfo($filename, PATHINFO_FILENAME) . '.mp4"',
                        'Cache-Control'                 => 'public, max-age=' . $ttl,
                        'Accept-Ranges'                 => 'bytes',
                        'Access-Control-Allow-Origin'   => '*',
                        'Access-Control-Allow-Methods'  => 'GET, HEAD, OPTIONS',
                        'Access-Control-Expose-Headers' => 'Content-Range, Content-Length, Accept-Ranges',
                    ]);
                }
            }

            return response()->stream(function () use ($telegram, $media) {
                $out = fopen('php://output', 'wb');
                $telegram->client()->downloadToStream($media, $out);
                fclose($out);
            }, 200, [
                'Content-Type'        => $mime,
                'Content-Disposition' => 'inline; filename="'.$filename.'"',
                'Accept-Ranges'       => 'bytes',
                'Cache-Control'       => 'public, max-age=3600',
                'X-Content-Type-Options' => 'nosniff',
                'Access-Control-Allow-Origin' => '*',
                'Access-Control-Allow-Methods' => 'GET, HEAD, OPTIONS',
            ]);

        } catch (\Illuminate\Contracts\Encryption\DecryptException $e) {
            Log::error('Decrypt error for stream: ' . $e->getMessage());
            abort(404, 'Invalid file ID');
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            Log::error('Bucket not found for stream: ' . $e->getMessage());
            abort(404, 'Bucket not found');
        } catch (Exception $e) {
            Log::error('Stream file error: ' . $e->getMessage());
            abort(404, 'File not found');
        }
    }
}
