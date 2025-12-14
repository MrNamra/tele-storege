<?php

namespace App\Interfaces;

use App\Models\Bucket;
use App\Models\BucketShare;
use Illuminate\Support\Collection;

interface BucketRepositoryInterface
{
    public function store(array $data): bool;
    public function update(array $data, Bucket $bucket): bool;
    public function destroy(Bucket $bucket): bool;
    public function listBuckets(): Collection;
    public function shareBucket($request): BucketShare;
    public function endShare($code): void;
}
