<?php

use App\Services\Telegram\TelegramClient;
use Illuminate\Support\Facades\Route;

Route::get('/tg/test', function (TelegramClient $tg) {
    $me = $tg->client()->getSelf();

    return $me;
});

Route::get('/{any?}', function () {
    $indexPath = public_path('index.html');
    if (! file_exists($indexPath)) {
        $indexPath = base_path('frontend/index.html');
    }
    if (file_exists($indexPath)) {
        return response()->file($indexPath, [
            'Content-Type' => 'text/html; charset=UTF-8',
        ]);
    }

    return view('welcome');
})->where('any', '(?!api|fallback).*');
