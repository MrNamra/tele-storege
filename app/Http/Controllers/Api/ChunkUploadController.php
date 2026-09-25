<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Bucket;
use App\Models\BucketShare;
use App\Models\UploadQueue;
use App\Trait\ApiResponseTrait;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Throwable;

class ChunkUploadController extends Controller
{
    use ApiResponseTrait;

    /**
     * Resolve bucket and verify authorization.
     * Supports both authenticated bucket owners and shared buckets.
     *
     * @return array{0: ?Bucket, 1: ?string, 2: int} [Bucket, ErrorMessage, StatusCode]
     */
    protected function resolveBucket(Request $request): array
    {
        $bucketId = $request->input('bucket_id');
        $code = $request->input('code');

        // Case A: Shared bucket upload via code
        if (! empty($code)) {
            $share = BucketShare::firstWhere(['code' => $code]);
            if (! $share || ! $share->bucket) {
                return [null, 'Shared bucket not found', 404];
            }

            if (! empty($share->password)) {
                $password = (string) $request->input('password', '');
                if ($password !== $share->password) {
                    return [null, 'Password is wrong!', 403];
                }
            }

            return [$share->bucket, null, 200];
        }

        // Case B: Authenticated user bucket upload
        if (! empty($bucketId)) {
            $user = $request->user('sanctum');
            if (! $user && $request->filled('token')) {
                $tokenModel = PersonalAccessToken::findToken($request->query('token') ?: $request->input('token'));
                if ($tokenModel) {
                    $user = $tokenModel->tokenable;
                }
            }

            if (! $user && $request->bearerToken()) {
                $tokenModel = PersonalAccessToken::findToken($request->bearerToken());
                if ($tokenModel) {
                    $user = $tokenModel->tokenable;
                }
            }

            if (! $user) {
                return [null, 'Unauthenticated', 401];
            }

            $bucket = Bucket::firstWhere(['id' => $bucketId, 'user_id' => $user->id]);
            if (! $bucket) {
                return [null, 'Bucket not found or unauthorized', 404];
            }

            return [$bucket, null, 200];
        }

        return [null, 'bucket_id or shared bucket code is required', 422];
    }

    /**
     * Initialize a chunked upload session or query existing uploaded chunks.
     */
    public function init(Request $request): JsonResponse
    {
        $request->validate([
            'file_name' => 'required|string|max:255',
            'file_size' => 'required|integer|min:1',
            'total_chunks' => 'required|integer|min:1',
            'file_identifier' => 'required|string',
            'chunk_size' => 'nullable|integer|min:1',
        ]);

        [$bucket, $error, $status] = $this->resolveBucket($request);
        if (! $bucket) {
            return self::errorResponse(message: $error, status: $status);
        }

        $fileName = (string) $request->input('file_name');
        $fileSize = (int) $request->input('file_size');
        $totalChunks = (int) $request->input('total_chunks');
        $chunkSize = (int) ($request->input('chunk_size') ?: 5242880); // Default 5MB
        $fileIdentifier = (string) $request->input('file_identifier');

        // Deterministic upload ID based on bucket ID and client file identifier
        $uploadId = hash('sha256', "{$bucket->id}_{$fileIdentifier}");

        $chunkDir = storage_path("app/chunks/{$uploadId}");
        if (! is_dir($chunkDir)) {
            @mkdir($chunkDir, 0775, true);
        }

        // Scan chunk directory for chunks that have already been uploaded
        $uploadedChunks = [];
        if (is_dir($chunkDir)) {
            $files = @scandir($chunkDir) ?: [];
            foreach ($files as $f) {
                if (preg_match('/^chunk_(\d+)$/', $f, $matches)) {
                    $idx = (int) $matches[1];
                    $path = "{$chunkDir}/{$f}";
                    if (file_exists($path) && filesize($path) > 0) {
                        $uploadedChunks[] = $idx;
                    }
                }
            }
            sort($uploadedChunks, SORT_NUMERIC);
        }

        // Persist upload init info in Cache
        Cache::put("chunk_upload_init_{$uploadId}", [
            'upload_id' => $uploadId,
            'bucket_id' => $bucket->id,
            'channel_id' => $bucket->channel_id,
            'file_name' => $fileName,
            'file_size' => $fileSize,
            'total_chunks' => $totalChunks,
            'chunk_size' => $chunkSize,
            'file_identifier' => $fileIdentifier,
            'updated_at' => now()->timestamp,
        ], now()->addHours(24));

        return self::successResponse(
            message: count($uploadedChunks) > 0 ? 'Resuming existing chunked upload' : 'Chunked upload initialized',
            data: [
                'upload_id' => $uploadId,
                'uploaded_chunks' => $uploadedChunks,
                'total_chunks' => $totalChunks,
                'chunk_size' => $chunkSize,
                'file_name' => $fileName,
                'resumed' => count($uploadedChunks) > 0,
            ]
        );
    }

    /**
     * Upload an individual chunk slice.
     * Supports both multipart/form-data ('chunk') and application/octet-stream (php://input).
     */
    public function uploadChunk(Request $request): JsonResponse
    {
        $uploadId = (string) ($request->input('upload_id') ?? $request->header('X-Upload-Id'));
        $chunkIndex = $request->input('chunk_index') ?? $request->header('X-Chunk-Index');

        if (empty($uploadId) || ! is_numeric($chunkIndex)) {
            return self::errorResponse(message: 'upload_id and chunk_index are required', status: 422);
        }

        $chunkIndex = (int) $chunkIndex;
        $chunkDir = storage_path("app/chunks/{$uploadId}");

        if (! is_dir($chunkDir)) {
            @mkdir($chunkDir, 0775, true);
        }

        $chunkPath = "{$chunkDir}/chunk_{$chunkIndex}";

        try {
            if ($request->hasFile('chunk')) {
                $file = $request->file('chunk');
                if (! $file->isValid()) {
                    return self::errorResponse(message: 'Invalid chunk file upload', status: 400);
                }
                $file->move($chunkDir, "chunk_{$chunkIndex}");
            } else {
                // Read from request body or php://input
                $rawContent = $request->getContent();
                if (! empty($rawContent)) {
                    file_put_contents($chunkPath, $rawContent);
                } else {
                    $input = fopen('php://input', 'rb');
                    $dest = fopen($chunkPath, 'wb');
                    if ($input && $dest) {
                        stream_copy_to_stream($input, $dest);
                        fclose($input);
                        fclose($dest);
                    }
                }
            }

            if (! file_exists($chunkPath) || filesize($chunkPath) === 0) {
                return self::errorResponse(message: 'Saved chunk is empty or missing', status: 500);
            }

            return self::successResponse(
                message: "Chunk {$chunkIndex} uploaded successfully",
                data: [
                    'upload_id' => $uploadId,
                    'chunk_index' => $chunkIndex,
                    'size' => filesize($chunkPath),
                ]
            );
        } catch (Throwable $e) {
            Log::error("Failed saving chunk {$chunkIndex} for upload {$uploadId}: ".$e->getMessage());

            return self::errorResponse(message: 'Failed to write chunk: '.$e->getMessage(), status: 500);
        }
    }

    /**
     * Complete chunked upload: verify all chunks, stream-merge them, and trigger background Telegram upload.
     */
    public function complete(Request $request): JsonResponse
    {
        $request->validate([
            'upload_id' => 'required|string',
        ]);

        $uploadId = (string) $request->input('upload_id');
        $init = Cache::get("chunk_upload_init_{$uploadId}");

        $chunkDir = storage_path("app/chunks/{$uploadId}");
        if (! is_dir($chunkDir)) {
            return self::errorResponse(message: 'Chunk upload directory not found or expired', status: 404);
        }

        $totalChunks = $init['total_chunks'] ?? null;
        if (! $totalChunks) {
            $files = @scandir($chunkDir) ?: [];
            $maxIdx = -1;
            foreach ($files as $f) {
                if (preg_match('/^chunk_(\d+)$/', $f, $m)) {
                    $maxIdx = max($maxIdx, (int) $m[1]);
                }
            }
            $totalChunks = $maxIdx + 1;
        }

        // Verify all chunks 0..totalChunks - 1 are present
        $missing = [];
        for ($i = 0; $i < $totalChunks; $i++) {
            $chunkFile = "{$chunkDir}/chunk_{$i}";
            if (! file_exists($chunkFile) || filesize($chunkFile) === 0) {
                $missing[] = $i;
            }
        }

        if (! empty($missing)) {
            return self::errorResponse(
                message: 'Missing chunk(s): '.implode(', ', array_slice($missing, 0, 10)).(count($missing) > 10 ? '...' : ''),
                status: 422
            );
        }

        $tempUploadDir = storage_path('app/temp_uploads');
        if (! is_dir($tempUploadDir)) {
            @mkdir($tempUploadDir, 0775, true);
        }

        $rawFileName = $init['file_name'] ?? ('file_'.time());
        // Clean filename to prevent path traversal
        $safeFileName = preg_replace('/[^\w\.\-\(\) ]+/u', '_', basename($rawFileName));
        $assembledPath = "{$tempUploadDir}/{$uploadId}_{$safeFileName}";

        // Stream merge chunks into assembled file slice by slice, deleting chunks immediately to preserve disk space
        $dest = fopen($assembledPath, 'wb');
        if (! $dest) {
            return self::errorResponse(message: 'Failed to create assembled temporary file', status: 500);
        }

        for ($i = 0; $i < $totalChunks; $i++) {
            $chunkFile = "{$chunkDir}/chunk_{$i}";
            $src = fopen($chunkFile, 'rb');
            if ($src) {
                stream_copy_to_stream($src, $dest);
                fclose($src);
                @unlink($chunkFile);
            }
        }
        fclose($dest);
        @rmdir($chunkDir);

        $assembledSize = filesize($assembledPath);

        // Enqueue into sequential queue (single worker, strict FIFO order)
        UploadQueue::enqueue([
            'upload_id' => $uploadId,
            'bucket_id' => $init['bucket_id'] ?? null,
            'channel_id' => $init['channel_id'] ?? null,
            'file_path' => $assembledPath,
            'file_name' => $rawFileName,
            'file_size' => $assembledSize,
        ]);

        return self::successResponse(
            message: 'File assembled successfully. Transferring to Telegram Cloud.',
            data: [
                'upload_id' => $uploadId,
                'status' => 'processing',
                'file_name' => $rawFileName,
                'size' => $assembledSize,
            ]
        );
    }

    /**
     * Check status and progress of an upload.
     */
    public function status(Request $request, string $uploadId): JsonResponse
    {
        $status = Cache::get("chunk_upload_status_{$uploadId}");

        if ($status) {
            return self::successResponse(data: $status);
        }

        $init = Cache::get("chunk_upload_init_{$uploadId}");
        if ($init) {
            return self::successResponse(data: [
                'status' => 'uploading_chunks',
                'progress' => 0,
                'message' => 'Uploading chunks to server',
                'error' => null,
            ]);
        }

        return self::errorResponse(message: 'Upload not found or expired', status: 404);
    }

    /**
     * Cancel an upload and clean up all temporary chunk files.
     */
    public function cancel(Request $request, string $uploadId): JsonResponse
    {
        $chunkDir = storage_path("app/chunks/{$uploadId}");
        if (is_dir($chunkDir)) {
            $files = @scandir($chunkDir) ?: [];
            foreach ($files as $f) {
                if ($f === '.' || $f === '..') {
                    continue;
                }
                @unlink("{$chunkDir}/{$f}");
            }
            @rmdir($chunkDir);
        }

        $meta = Cache::get("chunk_upload_meta_{$uploadId}");
        if (! empty($meta['file_path']) && file_exists($meta['file_path'])) {
            @unlink($meta['file_path']);
        }

        Cache::forget("chunk_upload_init_{$uploadId}");
        Cache::forget("chunk_upload_meta_{$uploadId}");
        Cache::forget("chunk_upload_status_{$uploadId}");

        return self::successResponse(message: 'Upload cancelled and temporary files cleaned up');
    }
}
