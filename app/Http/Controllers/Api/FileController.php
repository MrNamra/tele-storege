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
            $data = $this->fileRepo->bucketData($request->all(), $bucket);
            return Self::successResponse(data: $data);
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

    public function thumbnail(TelegramClient $telegram, Bucket $bucket, $id)
    {
        return $telegram->streamThumbnail(channelId: $bucket->channel_id, msgId: decrypt($id));
    }

    public function stream(TelegramClient $telegram, Bucket $bucket, $id)
    {
        return $telegram->streamFile(channelId: $bucket->channel_id, msgId: $id);
    }

    public function removeFile(Request $request,Bucket $bucket)
    {
        $request->validate([
            'file_id'=> 'required|array',
            'file_id.*' => 'required'
        ]);

        try {
            if(!$bucket->firstWhere('user_id', Auth::id())) {
                return Self::errorResponse(message:'Bucket or File not Find');
            }

            $this->fileRepo->deleteFiles(
                channel_id: $bucket->channel_id,
                IDs: $request->file_id
            );

            return Self::successResponse(message: 'File(s) Delete Successfully');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function downlaodFile(FileRequest $request)
    {
        try {
            $bucket = Bucket::firstWhere(['user_id' => auth()->id(), 'id' => $request->bucket_id]);

            if(!$bucket) {
                return Self::errorResponse(message: 'Bucket not found / Selected');
            }

            return $this->fileRepo->fileDownlaod($request->files, $bucket->chennel_id);

        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function downloadFile(Request $request)
    {
        try {
            $request->validate([
                'file_id' => 'required|string',
                'bucket_id' => 'required|exists:buckets,id',
            ]);

            $bucket = Bucket::firstWhere(['user_id' => auth()->id(), 'id' => $request->bucket_id]);

            if(!$bucket) {
                return Self::errorResponse(message: 'Bucket not found or access denied');
            }

            return $this->fileRepo->fileDownlaod($request->file_id, $bucket->channel_id);

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

            $bucket = Bucket::firstWhere(['user_id' => auth()->id(), 'id' => $request->bucket_id]);

            if(!$bucket) {
                return Self::errorResponse(message: 'Bucket not found or access denied');
            }

            $msgId = decrypt($request->file_id);

            $result = $telegram->client()->messages->getMessages([
                'peer' => $bucket->channel_id,
                'id'   => [$msgId],
            ]);

            $message = $result['messages'][0] ?? null;

            if (!$message || empty($message['media'])) {
                return Self::errorResponse(message: 'File not found');
            }

            $media = $message['media'];

            // Detect mime type and filename
            if (isset($media['photo'])) {
                $mime = 'image/jpeg';
                $filename = 'image.jpg';
            } elseif (isset($media['document'])) {
                $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
                $filename = 'file';
                foreach ($media['document']['attributes'] as $attr) {
                    if ($attr['_'] === 'documentAttributeFilename') {
                        $filename = $attr['file_name'];
                        break;
                    }
                }
            } else {
                return Self::errorResponse(message: 'Unsupported media type');
            }

            // Stream the file with proper headers for inline viewing
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
            ]);

        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function streamFileSigned(TelegramClient $telegram, Bucket $bucket, $id)
    {
        try {
            // Bucket is already resolved by route model binding

            $msgId = decrypt($id);

            if (!$msgId) {
                Log::error('Invalid file ID for stream: ' . $id);
                abort(404, 'Invalid file ID');
            }

            Log::info('Streaming file - bucket: ' . $bucket->id . ', channel_id: ' . $bucket->channel_id . ', msgId: ' . $msgId);

            // Use getHistory instead of getMessages (like streamThumbnail and downlaodFiles do)
            // This is more reliable for getting messages from channels
            $history = $telegram->client()->messages->getHistory(
                peer: $bucket->channel_id,
                offset_id: $msgId + 1,
                limit: 1
            );

            Log::info('Telegram API response: ' . json_encode(['messages_count' => count($history['messages'] ?? [])]));

            $message = $history['messages'][0] ?? null;

            if (!$message) {
                Log::error('Message not found for stream - bucket: ' . $bucket->id . ', channel_id: ' . $bucket->channel_id . ', msgId: ' . $msgId);
                abort(404, 'File not found - message does not exist');
            }

            if (empty($message['media'])) {
                Log::error('Message has no media - bucket: ' . $bucket->id . ', msgId: ' . $msgId . ', message: ' . json_encode($message));
                abort(404, 'File not found - no media');
            }

            $media = $message['media'];

            // Detect mime type and filename
            if (isset($media['photo'])) {
                $mime = 'image/jpeg';
                $filename = 'image.jpg';
            } elseif (isset($media['document'])) {
                $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
                $filename = 'file';
                foreach ($media['document']['attributes'] as $attr) {
                    if ($attr['_'] === 'documentAttributeFilename') {
                        $filename = $attr['file_name'];
                        break;
                    }
                }
            } else {
                Log::error('Unsupported media type for stream - bucket: ' . $bucket->id);
                abort(404, 'Unsupported media type');
            }

            // Stream the file with proper headers for inline viewing
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
                'Access-Control-Allow-Methods' => 'GET',
            ]);

        } catch (\Illuminate\Contracts\Encryption\DecryptException $e) {
            Log::error('Decrypt error for stream: ' . $e->getMessage());
            abort(404, 'Invalid file ID');
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            Log::error('Bucket not found for stream: ' . $e->getMessage());
            abort(404, 'Bucket not found');
        } catch (Exception $e) {
            Log::error('Stream file error: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString());
            abort(404, 'File not found: ' . $e->getMessage());
        }
    }
}
