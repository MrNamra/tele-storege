<?php

namespace App\Repositories;

use App\Interfaces\BucketRepositoryInterface;
use App\Models\Bucket;
use Illuminate\Support\Facades\Auth;

class BucketRepository implements BucketRepositoryInterface
{
    public function store(array $data)
    {
        Auth::user()->decrement('bucketAllowed', 1);

        Bucket::create([
            'user_id' => Auth::id(),
            'bucketName' => $data['name']
        ]);

        return true;
    }
}
