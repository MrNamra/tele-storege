<?php

namespace App\Repositories;

use App\Interfaces\FileRepositoryInterface;
use App\Models\Bucket;
use App\Services\Telegram\TelegramClient;

class FileRepository implements FileRepositoryInterface
{
    protected TelegramClient $telegram;

    public function __construct(TelegramClient $telegram)
    {
        $this->telegram = $telegram;
    }

    public function fileUpload($files, Bucket $bucket): array
    {
        $results = [];
        foreach ($files as $file) {
            $originalName = $file->getClientOriginalName();
            // $stream = fopen($file->getRealPath(), 'rb');

            // Upload to Telegram in chunks
            $upload = $this->telegram->uploadFileToChannel(
                $bucket->channel_id,
                $file,
                $originalName
            );

            $results[] = [
                'name' => $originalName,
                'uploaded' => true,
                'telegram_file' => $upload
            ];

            // fclose($stream);
            sleep(1);
        }
        return $results;
    }

    public function bucketData($data, Bucket $bucket): array
    {
        $page = $data['page'] ?? 1;
        $perPage = $data['perPage'] ?? 5;

        return $this->telegram->getChannelFiles(
            channelId: $bucket->channel_id,
            // accessHash: $bucket->access_hash,
            page: $page,
            perPage: $perPage
        );

    }

    public function streamThumbnail(Bucket $bucket, int $messageId)
    {
        return $this->telegram->streamThumbnailFromTelegram(
            $bucket->channel_id,
            $messageId
        );

    }
}
