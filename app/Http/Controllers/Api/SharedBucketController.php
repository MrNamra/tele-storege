<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\CodeFileUploadRequest;
use App\Interfaces\FileRepositoryInterface;
use App\Models\BucketShare;
use App\Trait\ApiResponseTrait;
use Exception;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\JsonResponse;

class SharedBucketController extends Controller
{
    use ApiResponseTrait;

    protected $bucket;

    public function __construct(FileRepositoryInterface $bucket)
    {
        $this->bucket = $bucket;
    }

    public function index(Request $request, $code): JsonResponse
    {
        try {
            $bucketShare = BucketShare::firstWhere(['code' => $code]);
            if (! $bucketShare || ! $bucketShare->bucket) {
                return self::errorResponse(message: 'Shared bucket not found', status: 404);
            }

            $response = $this->bucket->bucketData($request->all(), $bucketShare->bucket);

            if (isset($response['files']) && isset($response['pagination'])) {
                return self::successResponse(
                    data: $response['files'],
                    pagination: $response['pagination'],
                    totalStorage: $response['totalStorage'] ?? 0
                );
            }

            return self::successResponse(data: $response);
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function uploadFile(CodeFileUploadRequest $request, $code): JsonResponse
    {
        try {
            $bucketShare = BucketShare::firstWhere(['code' => $code]);
            if (! $bucketShare || ! $bucketShare->bucket) {
                return self::errorResponse(message: 'Shared bucket not found', status: 404);
            }

            if (! empty($bucketShare->password) && $bucketShare->password !== $request->password) {
                return self::errorResponse(message: 'Password is wrong!', status: 403);
            }

            $this->bucket->fileUpload($request->file('files'), $bucketShare->bucket);

            return self::successResponse(message: 'File(s) Upload Successful');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function downloadFile(Request $request, $code, $fileId = null)
    {
        try {
            $bucketShare = BucketShare::firstWhere(['code' => $code]);
            if (! $bucketShare) {
                return self::errorResponse(message: 'Shared bucket not found!', status: 404);
            }

            $bucket = $bucketShare->bucket;
            if (! $bucket) {
                return self::errorResponse(message: 'Bucket not found!', status: 404);
            }

            $id = $fileId ?? $request->input('file_id') ?? $request->query('file_id');
            if (! $id) {
                return self::errorResponse(message: 'File ID is required', status: 422);
            }

            return $this->bucket->fileDownload($id, $bucket->channel_id);

        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }
}
