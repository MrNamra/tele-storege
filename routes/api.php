<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BucketController;
use App\Http\Controllers\Api\FileController;
use App\Http\Controllers\Api\SharedBucketController;
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

        Route::post('/share', [BucketController::class,'shareBucket']);
        Route::post('/end-share/{code}', [BucketController::class,'endShare']);

        Route::post('/file/upload', [FileController::class, 'uploadFile']);

        Route::post('{bucket}/delete-file', [FileController::class, 'removeFile']);
    });

});
Route::get('/buckets/display/{bucket}/{fileId}', [BucketController::class, 'showBucketFile'])->middleware('signed');

// Route::get('bucket/show/{code}', [BucketController::class,'']);
// Route::get('bucket/show/{code}/{fileId}', [BucketController::class,'']);
Route::get('/thumbnail/{bucket}/{id}', [FileController::class, 'thumbnail'])->name('thumbnail')->middleware('signed');
Route::get('/stream/{id}', [FileController::class, 'stream'])->name('stream.file');
Route::get('/show/{code}', [SharedBucketController::class, 'index'])->name('shared.bucket-data');
Route::post('files/upload/{code}', [SharedBucketController::class, 'uploadFile'])->name('shared.bucket-data');
