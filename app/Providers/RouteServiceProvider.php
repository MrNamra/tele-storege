<?php

namespace App\Providers;

use App\Models\Bucket;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        Route::bind('bucket', function ($value) {
        $ids = decryptId($value);

        if (empty($ids)) abort(404);

        return Bucket::where('id', $ids[0])
                    // ->where('user_id', auth()->id())
                    ->firstOrFail();
            });
    }
}
