<?php

namespace App\Console\Commands;

use App\Services\Telegram\TelegramClient;
use Illuminate\Console\Command;

class CleanStorageCache extends Command
{
    protected $signature = 'storage:clean-cache 
                            {--hours=2 : Cache lifetime in hours; files older than this will be deleted} 
                            {--all : Force remove all cached thumbnails and converted files regardless of age}';

    protected $description = 'Clean expired thumbnail, HEIC conversion, and temporary cache files from the server';

    public function handle()
    {
        $all = $this->option('all');
        $hours = (float) $this->option('hours');
        $ttlSeconds = $all ? 0 : (int) round($hours * 3600);

        if ($all) {
            $this->info('Purging ALL cache files from server...');
        } else {
            $this->info("Cleaning cache files older than {$hours} hour(s) ({$ttlSeconds} seconds)...");
        }

        $result = TelegramClient::pruneExpiredCache($ttlSeconds);

        $deleted = $result['deleted'] ?? 0;
        $bytes = $result['bytes'] ?? 0;
        $formattedSize = $this->formatBytes($bytes);

        $this->info("✓ Successfully removed {$deleted} expired cache file(s).");
        $this->info("✓ Freed {$formattedSize} of disk space.");

        return 0;
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes >= 1073741824) {
            return number_format($bytes / 1073741824, 2).' GB';
        }
        if ($bytes >= 1048576) {
            return number_format($bytes / 1048576, 2).' MB';
        }
        if ($bytes >= 1024) {
            return number_format($bytes / 1024, 2).' KB';
        }

        return $bytes.' Bytes';
    }
}
