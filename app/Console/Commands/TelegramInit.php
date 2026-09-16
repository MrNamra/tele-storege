<?php

namespace App\Console\Commands;

use App\Services\Telegram\TelegramClient;
use Illuminate\Console\Command;

class TelegramInit extends Command
{
    protected $signature = 'telegram:init {--force : Force re-login}';

    protected $description = 'Initialize or log in to MadelineProto Telegram session';

    public function handle()
    {
        $this->info('Connecting to Telegram via MadelineProto...');
        $tg = new TelegramClient;

        if ($tg->isLoggedIn() && ! $this->option('force')) {
            try {
                $me = $tg->client()->getSelf();
                $name = trim(($me['first_name'] ?? '').' '.($me['last_name'] ?? ''));
                $username = isset($me['username']) ? "@{$me['username']}" : 'No username';
                $id = $me['id'] ?? 'Unknown';
                $this->info("✓ Already logged in as: {$name} ({$username}, ID: {$id})");

                return 0;
            } catch (\Throwable $e) {
                $this->warn('Session check failed: '.$e->getMessage().'. Re-initiating login...');
            }
        }

        $this->info('Starting interactive login (you will be prompted for phone/code or QR scan)...');
        try {
            $me = $tg->connect();
            $this->info('✓ Telegram session initialized successfully!');
            if (is_array($me) && isset($me['id'])) {
                $this->info('Logged in as ID: '.$me['id']);
            }

            return 0;
        } catch (\Throwable $e) {
            $this->error('Login failed: '.$e->getMessage());

            return 1;
        }
    }
}
