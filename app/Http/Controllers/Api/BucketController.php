<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\BucketRequest;
use App\Interfaces\BucketRepositoryInterface;
use App\Trait\ApiResponseTrait;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class BucketController extends Controller
{
    use ApiResponseTrait;
    protected $bucketRepo;
    public function __construct(BucketRepositoryInterface $bucketRepo)
    {
        $this->bucketRepo = $bucketRepo;
    }
    public function store(BucketRequest $request)
    {
        if(Auth::user()->bucketAllowed < 1)
            return $this->errorResponse(message: 'Insufficient Bucket Bucket balance');

        $bucket = $this->bucketRepo->store($request->all());
        return $this->successResponse(message: 'Bucket Created Successfully');
    }
}
