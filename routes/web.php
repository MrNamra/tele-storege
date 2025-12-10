<?php

use App\Services\Telegram\TelegramClient;
use Illuminate\Support\Facades\Route;


Route::get('/', function () {
    return view('welcome');
});

Route::get('/tg/test', function (TelegramClient $tg) {
    $me = $tg->client()->getSelf();
    return $me;
});
