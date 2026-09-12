<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class TelegramLogin extends Command
{
    protected $signature = 'telegram:login {--force : Force re-login}';
    protected $description = 'Interactive Telegram login for MadelineProto';

    public function handle()
    {
        return $this->call('telegram:init', [
            '--force' => $this->option('force'),
        ]);
    }
}
