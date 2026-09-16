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
                // 'telegram_file' => $upload
            ];

            // fclose($stream);
            sleep(1);
        }

        return $results;
    }

    public function bucketData($data, Bucket $bucket): array
    {
        $page = max(1, (int) ($data['page'] ?? 1));
        $perPage = max(1, (int) ($data['limit'] ?? 15));

        return $this->telegram->getChannelFiles(
            channelId: $bucket->channel_id,
            bucket_id: $bucket->id,
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

    public function deleteFiles(int|string $channel_id, array $IDs): bool
    {
        $this->telegram->deleteFiles(channel_id: $channel_id, IDs: $IDs);

        return true;
    }

    public function fileDownlaod($files, $chennel_id)
    {
        return $this->fileDownload($files, $chennel_id);
    }

    public function fileDownload($files, $channel_id)
    {
        $id = safeDecryptId($files) ?? (is_numeric($files) ? (int) $files : decrypt($files));

        return $this->telegram->downlaodFiles($id, $channel_id);
    }
}
