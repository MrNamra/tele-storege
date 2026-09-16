<?php

namespace App\Console\Commands;

use App\Services\Telegram\TelegramClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class ProcessChunkUpload extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'bucket:process-upload {upload_id : The unique upload identifier}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Process assembled chunk upload and transfer to Telegram Cloud in background';

    /**
     * Execute the console command.
     */
    public function handle(TelegramClient $telegram): int
    {
        $uploadId = (string) $this->argument('upload_id');
        $meta = Cache::get("chunk_upload_meta_{$uploadId}");

        if (! $meta) {
            $this->error("Upload metadata not found for ID: {$uploadId}");
            Cache::put("chunk_upload_status_{$uploadId}", [
                'status' => 'failed',
                'progress' => 0,
                'message' => 'Upload metadata expired or not found',
                'error' => 'Upload metadata expired or not found',
            ], now()->addHours(2));

            return 1;
        }

        $filePath = $meta['file_path'] ?? null;
        $channelId = $meta['channel_id'] ?? null;
        $fileName = $meta['file_name'] ?? 'file';

        if (! $filePath || ! file_exists($filePath)) {
            $this->error("Assembled file does not exist: {$filePath}");
            Cache::put("chunk_upload_status_{$uploadId}", [
                'status' => 'failed',
                'progress' => 0,
                'message' => 'Assembled file not found on server disk',
                'error' => 'Assembled file not found on server disk',
            ], now()->addHours(2));

            return 1;
        }

        $this->info("Starting Telegram MTProto upload for {$fileName} (Upload ID: {$uploadId})...");

        Cache::put("chunk_upload_status_{$uploadId}", [
            'status' => 'uploading_to_telegram',
            'progress' => 0,
            'message' => 'Uploading to Telegram Cloud...',
            'error' => null,
        ], now()->addHours(2));

        $lastReportTime = 0.0;
        $progressCallback = function (int $uploaded, int $total) use ($uploadId, &$lastReportTime) {
            $now = microtime(true);
            if ($now - $lastReportTime >= 0.4 || $uploaded >= $total) {
                $lastReportTime = $now;
                $percent = $total > 0 ? min(99, max(1, (int) round(($uploaded / $total) * 100))) : 50;
                Cache::put("chunk_upload_status_{$uploadId}", [
                    'status' => 'uploading_to_telegram',
                    'progress' => $percent,
                    'uploaded_bytes' => $uploaded,
                    'total_bytes' => $total,
                    'message' => "Uploading to Telegram Cloud ({$percent}%)...",
                    'error' => null,
                ], now()->addHours(2));
            }
        };

        try {
            // MadelineProto upload & sendMedia
            $telegram->uploadFileToChannel(
                channelId: (string) $channelId,
                file: $filePath,
                originalName: $fileName,
                progressCallback: $progressCallback
            );

            Cache::put("chunk_upload_status_{$uploadId}", [
                'status' => 'completed',
                'progress' => 100,
                'message' => 'File uploaded successfully to Telegram Cloud',
                'error' => null,
            ], now()->addHours(2));

            $this->info("✓ Successfully uploaded {$fileName} to Telegram channel {$channelId}.");

            return 0;
        } catch (Throwable $e) {
            Log::error("Telegram upload failed for {$uploadId}: ".$e->getMessage(), [
                'trace' => $e->getTraceAsString(),
            ]);

            Cache::put("chunk_upload_status_{$uploadId}", [
                'status' => 'failed',
                'progress' => 0,
                'message' => 'Failed to upload file to Telegram: '.$e->getMessage(),
                'error' => $e->getMessage(),
            ], now()->addHours(2));

            $this->error('✗ Failed to upload file: '.$e->getMessage());

            return 1;
        } finally {
            // Always unlink assembled temp file to preserve disk space
            if (file_exists($filePath)) {
                @unlink($filePath);
            }
            // Also clean metadata
            Cache::forget("chunk_upload_meta_{$uploadId}");
        }
    }
}
