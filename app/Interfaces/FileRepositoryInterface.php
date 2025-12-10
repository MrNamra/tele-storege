<?php

namespace App\Interfaces;

use App\Models\Bucket;

interface FileRepositoryInterface
{
    public function fileUpload($request, Bucket $bucket): array;
    public function bucketData($request, Bucket $bucket): array;
    public function streamThumbnail(Bucket $bucket, int $messageId);
}
