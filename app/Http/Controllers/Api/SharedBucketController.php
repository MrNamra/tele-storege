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
            $bucket = BucketShare::firstWhere(["code"=> $code]);
            $response = $this->bucket->bucketData($request, $bucket->bucket);
            return Self::successResponse(data: $response);
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function uploadFile(CodeFileUploadRequest $request, $code): JsonResponse
    {
        try {
            $bucket = BucketShare::firstWhere(["code"=> $code, 'password' => $request->password]);
            $this->bucket->fileUpload($request->file('files'), $bucket->bucket);
            return Self::successResponse(message: 'File(s) Upload Successfull');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

}
