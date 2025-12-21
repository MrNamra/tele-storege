<?php

namespace App\Interfaces;

use App\Models\Bucket;

interface FileRepositoryInterface
{
    public function fileUpload($request, Bucket $bucket): array;
    public function bucketData($request, Bucket $bucket): array;
    public function streamThumbnail(Bucket $bucket, int $messageId);
    public function deleteFiles(int|string $channel_id, array $IDs): bool;
    public function fileDownlaod($files, $chennel_id);
}
