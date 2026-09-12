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
            $bucketShare = BucketShare::firstWhere(["code" => $code]);
            if (!$bucketShare || !$bucketShare->bucket) {
                return Self::errorResponse(message: 'Shared bucket not found', status: 404);
            }

            $response = $this->bucket->bucketData($request->all(), $bucketShare->bucket);
            return Self::successResponse(data: $response);
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function uploadFile(CodeFileUploadRequest $request, $code): JsonResponse
    {
        try {
            $bucketShare = BucketShare::firstWhere(["code" => $code]);
            if (!$bucketShare || !$bucketShare->bucket) {
                return Self::errorResponse(message: 'Shared bucket not found', status: 404);
            }

            if (!empty($bucketShare->password) && $bucketShare->password !== $request->password) {
                return Self::errorResponse(message: 'Password is wrong!', status: 403);
            }

            $this->bucket->fileUpload($request->file('files'), $bucketShare->bucket);
            return Self::successResponse(message: 'File(s) Upload Successful');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function downloadFile(Request $request, $code, $fileId = null)
    {
        try {
            $bucketShare = BucketShare::firstWhere(["code" => $code]);
            if (!$bucketShare) {
                return Self::errorResponse(message: 'Shared bucket not found!', status: 404);
            }

            if (!empty($bucketShare->password) && $bucketShare->password !== $request->input('password')) {
                return Self::errorResponse(message: 'Password is wrong!', status: 403);
            }

            $bucket = $bucketShare->bucket;
            if (!$bucket) {
                return Self::errorResponse(message: 'Bucket not found!', status: 404);
            }

            $id = $fileId ?? $request->input('file_id') ?? $request->query('file_id');
            if (!$id) {
                return Self::errorResponse(message: 'File ID is required', status: 422);
            }

            return $this->bucket->fileDownload($id, $bucket->channel_id);

        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

}
