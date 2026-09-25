<?php

namespace App\Console\Commands;

use App\Models\UploadQueue;
use App\Services\Telegram\TelegramClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class ProcessUploadQueue extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'bucket:process-queue';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Process queued file uploads to Telegram Cloud sequentially (strict FIFO order, single worker)';

    /**
     * Execute the console command.
     */
    public function handle(TelegramClient $telegram): int
    {
        // Enforce strictly 1 worker at a time via atomic lock
        $lock = Cache::lock('bucket_upload_worker_lock', 7200);

        if (! $lock->get()) {
            $this->line('Another upload worker is already active. Exiting to maintain sequential processing.');

            return 0;
        }

        Cache::put('bucket_upload_worker_active', true, now()->addHours(2));

        $this->info('Sequential upload worker started.');

        try {
            while (true) {
                // Fetch the oldest pending file in exact insertion order (FIFO)
                $job = UploadQueue::where('status', 'pending')
                    ->orderBy('id', 'asc')
                    ->first();

                if (! $job) {
                    $this->info('No more pending uploads in queue. Worker exiting cleanly.');
                    break;
                }

                $job->update([
                    'status' => 'processing',
                    'progress' => 0,
                ]);

                $uploadId = (string) $job->upload_id;
                $filePath = (string) $job->file_path;
                $channelId = (string) $job->channel_id;
                $fileName = (string) $job->file_name;

                Cache::put("chunk_upload_status_{$uploadId}", [
                    'status' => 'uploading_to_telegram',
                    'progress' => 0,
                    'message' => "Uploading {$fileName} to Telegram Cloud in sequence...",
                    'error' => null,
                ], now()->addHours(2));

                if (! file_exists($filePath) || filesize($filePath) === 0) {
                    $job->update([
                        'status' => 'failed',
                        'error' => 'File not found on server disk',
                    ]);

                    Cache::put("chunk_upload_status_{$uploadId}", [
                        'status' => 'failed',
                        'progress' => 0,
                        'message' => 'File not found on server disk',
                        'error' => 'File not found on server disk',
                    ], now()->addHours(2));

                    continue;
                }

                $this->info("Processing [Queue #{$job->id}]: {$fileName} ({$job->file_size} bytes) -> channel {$channelId}...");

                $lastReport = 0.0;
                $progressCallback = function (int $uploaded, int $total) use ($job, $uploadId, $fileName, &$lastReport) {
                    $now = microtime(true);
                    if ($now - $lastReport >= 0.5 || $uploaded >= $total) {
                        $lastReport = $now;
                        $pct = $total > 0 ? min(99, max(1, (int) round(($uploaded / $total) * 100))) : 50;
                        $job->update(['progress' => $pct]);
                        Cache::put("chunk_upload_status_{$uploadId}", [
                            'status' => 'uploading_to_telegram',
                            'progress' => $pct,
                            'uploaded_bytes' => $uploaded,
                            'total_bytes' => $total,
                            'message' => "Uploading {$fileName} to Telegram Cloud ({$pct}%)...",
                            'error' => null,
                        ], now()->addHours(2));
                    }
                };

                try {
                    $telegram->uploadFileToChannel(
                        channelId: $channelId,
                        file: $filePath,
                        originalName: $fileName,
                        progressCallback: $progressCallback
                    );

                    $job->update([
                        'status' => 'completed',
                        'progress' => 100,
                    ]);

                    Cache::put("chunk_upload_status_{$uploadId}", [
                        'status' => 'completed',
                        'progress' => 100,
                        'message' => 'File uploaded successfully to Telegram Cloud',
                        'error' => null,
                    ], now()->addHours(2));

                    $this->info("✓ Successfully uploaded [Queue #{$job->id}]: {$fileName}");
                } catch (Throwable $e) {
                    Log::error("Sequential upload failed for {$uploadId} ({$fileName}): ".$e->getMessage(), [
                        'trace' => $e->getTraceAsString(),
                    ]);

                    $job->update([
                        'status' => 'failed',
                        'error' => $e->getMessage(),
                    ]);

                    Cache::put("chunk_upload_status_{$uploadId}", [
                        'status' => 'failed',
                        'progress' => 0,
                        'message' => 'Upload failed: '.$e->getMessage(),
                        'error' => $e->getMessage(),
                    ], now()->addHours(2));

                    $this->error("✗ Failed [Queue #{$job->id}]: {$fileName} - ".$e->getMessage());
                } finally {
                    // Immediately delete the local assembled file to free server disk space
                    if (file_exists($filePath)) {
                        @unlink($filePath);
                    }
                    Cache::forget("chunk_upload_meta_{$uploadId}");
                }

                // Collect cycles to prevent memory accumulation in PHP long-running process
                gc_collect_cycles();

                // 1-second pause between uploads to allow web traffic (streaming, previews) to breathe
                sleep(1);
            }

            return 0;
        } finally {
            Cache::forget('bucket_upload_worker_active');
            $lock->release();
        }
    }
}
