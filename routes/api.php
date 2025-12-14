<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BucketController;
use App\Http\Controllers\Api\FileController;
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
        Route::post('/edit/{bucket}', [BucketController::class, 'update']);
        Route::post('/delete/{bucket}', [BucketController::class, 'destroy']);

        Route::get('/list', [BucketController::class, 'listBuckets']);
        Route::get('/display/{bucket}', [FileController::class, 'showBucketData']);
        Route::get('/display/{bucket}/{fileId}', [BucketController::class, 'showBucketFile']);

        Route::post('/share', [BucketController::class,'shareBucket']);
        Route::post('/end-share/{code}', [BucketController::class,'endShare']);

        Route::post('/file/upload', [FileController::class, 'uploadFile']);
    });

});

// Route::get('bucket/show/{code}', [BucketController::class,'']);
// Route::get('bucket/show/{code}/{fileId}', [BucketController::class,'']);
Route::get('/thumbnail/{bucket}/{id}', [FileController::class, 'thumbnail'])->name('thumbnail');
Route::get('/stream/{id}', [FileController::class, 'stream'])->name('stream.file');
