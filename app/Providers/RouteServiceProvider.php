<?php

namespace App\Providers;

use App\Models\Bucket;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

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
        // parent::boot();
        Route::bind('bucket', function ($value) {
            //     $ids = decryptId($value);

            //     if (empty($ids)) abort(404);

            //     return Bucket::where('id', $ids[0])
            //             // ->where('user_id', auth()->id())
            //             ->firstOrFail();
            return Bucket::where('id', $value)
            // ->where('user_id', auth()->id())
                ->firstOrFail();
        });
        // return Bucket::where('user_id', auth()->id())
        //         ->get()
        //         ->map(fn ($bucket) => [
        //             'id'   => URL::signedRoute('bucket.show', ['bucket' => $bucket->id]),
        //             'name' => $bucket->bucketName,
        //         ]);
    }
}
