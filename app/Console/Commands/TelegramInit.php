<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\Telegram\TelegramClient;

class TelegramInit extends Command
{
    protected $signature = 'telegram:init';
    protected $description = 'Initialize MadelineProto session';

    public function handle()
    {
        $tg = new TelegramClient();
        $tg->connect(); // Will wait for OTP
        $this->info("Telegram session initialized successfully!");
    }
}
