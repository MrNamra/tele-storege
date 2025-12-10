<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\BucketRequest;
use App\Interfaces\BucketRepositoryInterface;
use App\Models\Bucket;
use App\Trait\ApiResponseTrait;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

class BucketController extends Controller
{
    use ApiResponseTrait;
    protected $bucketRepo;
    public function __construct(BucketRepositoryInterface $bucketRepo)
    {
        $this->bucketRepo = $bucketRepo;
    }
    public function store(BucketRequest $request): JsonResponse
    {
        try {
            if (Auth::user()->bucketAllowed < 1) {
                return Self::errorResponse(message: 'Insufficient Bucket Bucket balance');
            }

            return $this->bucketRepo->store($request->all()) ?
                Self::successResponse(message: 'Bucket Created Successfully') :
                Self::ERRORResponse(message: 'Fail to Created Bucket');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function update(BucketRequest $request, Bucket $bucket): JsonResponse
    {
        try {
            return $this->bucketRepo->update( $request->all(), $bucket)?
                    Self::successResponse(message: 'Bucket Name Update Successfull') :
                    Self::errorResponse(message: 'Fail to UpdateBucket Name');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function destroy(Bucket $bucket): JsonResponse
    {
        try {
            return $this->bucketRepo->destroy($bucket) ?
                    Self::successResponse(message: 'Bucket Delete Successfull'):
                    Self::errorResponse(message: 'Bucket Fail to Delete');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function listBuckets(): JsonResponse
    {
        $data = $this->bucketRepo->listBuckets();

        return Self::successResponse(data: $data);
    }
}
