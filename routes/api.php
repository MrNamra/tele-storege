<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BucketController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::post('/register',[AuthController::class, 'register']);
Route::post('/login',[AuthController::class, 'login']);

Route::group(['middleware' => 'auth:sanctum'], function () {
    // user routes
    Route::group(['prefix'=> '/user'], function () {
        Route::get('/profile', [AuthController::class,'profile']);
        Route::post('/profile', [AuthController::class,'updateProfile']);
        Route::get('/dashboard', [AuthController::class,'dashboard']);
    });

    // Bucket routes
    Route::group(['prefix'=> '/bucket'], function () {
        Route::post('/create', [BucketController::class, 'store']);
    });
});
