<?php

namespace App\Providers;

use App\Interfaces\AuthRepositoryInterface;
use App\Interfaces\BucketRepositoryInterface;
use App\Interfaces\FileRepositoryInterface;
use App\Repositories\AuthRepository;
use App\Repositories\BucketRepository;
use App\Repositories\FileRepository;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(AuthRepositoryInterface::class, AuthRepository::class);
        $this->app->bind(BucketRepositoryInterface::class, BucketRepository::class);
        $this->app->bind(FileRepositoryInterface::class, FileRepository::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
