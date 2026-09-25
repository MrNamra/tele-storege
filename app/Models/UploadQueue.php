<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class UploadQueue extends Model
{
    protected $fillable = [
        'upload_id',
        'bucket_id',
        'channel_id',
        'file_path',
        'file_name',
        'file_size',
        'status',
        'progress',
        'error',
    ];

    /**
     * Enqueue a file for sequential background upload to Telegram.
     */
    public static function enqueue(array $attributes): self
    {
        $queueItem = self::create([
            'upload_id' => $attributes['upload_id'],
            'bucket_id' => $attributes['bucket_id'] ?? null,
            'channel_id' => (string) $attributes['channel_id'],
            'file_path' => $attributes['file_path'],
            'file_name' => $attributes['file_name'],
            'file_size' => $attributes['file_size'] ?? 0,
            'status' => 'pending',
            'progress' => 0,
            'error' => null,
        ]);

        // Initialize status in cache for instant UI polling
        Cache::put("chunk_upload_status_{$queueItem->upload_id}", [
            'status' => 'processing',
            'progress' => 0,
            'message' => 'Upload queued in sequence for Telegram transfer...',
            'error' => null,
        ], now()->addHours(2));

        self::dispatchWorker();

        return $queueItem;
    }

    /**
     * Ensure the background sequential worker is dispatched if not already active.
     */
    public static function dispatchWorker(): void
    {
        // If worker is already marked active in cache, do not spawn another process
        if (Cache::has('bucket_upload_worker_active')) {
            return;
        }

        $artisan = base_path('artisan');
        $php = PHP_BINARY ?: 'php';
        // Run with nice -n 15 so web traffic (streaming, viewing) always gets top CPU priority on 1-core VPS
        $cmd = 'nice -n 15 '.escapeshellcmd($php).' '.escapeshellarg($artisan).' bucket:process-queue > /dev/null 2>&1 &';
        @exec($cmd);
    }
}
