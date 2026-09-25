<?php

use App\Services\Telegram\TelegramClient;
use Illuminate\Support\Facades\Route;

Route::get('/tg/test', function (TelegramClient $tg) {
    $me = $tg->client()->getSelf();

    return $me;
});

Route::match(['get', 'post'], '/share-target', function () {
    return redirect('/dashboard?shared=1');
});

Route::get('/{any?}', function (?string $any = null) {
    if ($any) {
        $candidatePaths = [
            public_path($any),
            base_path('frontend/'.$any),
        ];

        foreach ($candidatePaths as $file) {
            if (file_exists($file) && ! is_dir($file)) {
                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                $mime = match ($ext) {
                    'json', 'webmanifest' => 'application/manifest+json; charset=UTF-8',
                    'js', 'mjs' => 'application/javascript; charset=UTF-8',
                    'css' => 'text/css; charset=UTF-8',
                    'png' => 'image/png',
                    'jpg', 'jpeg' => 'image/jpeg',
                    'svg' => 'image/svg+xml',
                    'ico' => 'image/x-icon',
                    'webp' => 'image/webp',
                    default => mime_content_type($file) ?: 'application/octet-stream',
                };

                $headers = ['Content-Type' => $mime];
                if ($any === 'sw.js') {
                    $headers['Service-Worker-Allowed'] = '/';
                    $headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                } elseif ($any === 'manifest.json') {
                    $headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                }

                return response()->file($file, $headers);
            }
        }
    }

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
