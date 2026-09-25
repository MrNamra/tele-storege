<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BucketController;
use App\Http\Controllers\Api\ChunkUploadController;
use App\Http\Controllers\Api\FileController;
use App\Http\Controllers\Api\SharedBucketController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);

// Resumable Chunked Upload routes
Route::group(['prefix' => '/upload'], function () {
    Route::post('/init', [ChunkUploadController::class, 'init']);
    Route::post('/chunk', [ChunkUploadController::class, 'uploadChunk']);
    Route::post('/complete', [ChunkUploadController::class, 'complete']);
    Route::get('/status/{uploadId}', [ChunkUploadController::class, 'status']);
    Route::post('/cancel/{uploadId}', [ChunkUploadController::class, 'cancel']);
});

Route::group(['middleware' => 'auth:sanctum'], function () {
    // user routes
    Route::group(['prefix' => '/user'], function () {
        Route::get('/profile', [AuthController::class, 'profile']);
        Route::post('/profile', [AuthController::class, 'updateProfile']);
        Route::get('/dashboard', [AuthController::class, 'dashboard']);
    });

    // Bucket routes
    Route::group(['prefix' => '/bucket'], function () {
        Route::post('/create', [BucketController::class, 'store']);
        Route::post('/edit/{bucket}', [BucketController::class, 'update']);
        Route::post('/delete/{bucket}', [BucketController::class, 'destroy']);

        Route::get('/list', [BucketController::class, 'listBuckets']);
        Route::get('/display/{bucket}', [FileController::class, 'showBucketData']);

        Route::post('/share', [BucketController::class, 'shareBucket']);
        Route::post('/end-share/{code}', [BucketController::class, 'endShare']);

        Route::post('/file/upload', [FileController::class, 'uploadFile']);

        Route::post('{bucket}/delete-file', [FileController::class, 'removeFile']);

        Route::match(['get', 'post'], '/file/download/{bucket?}/{fileId?}', [FileController::class, 'downloadFile'])->where('fileId', '.*');
        Route::get('/file/stream', [FileController::class, 'streamFile']);
        Route::post('/file/stream', [FileController::class, 'streamFile']);
    });

    // Admin routes (requires role = admin)
    Route::group(['prefix' => '/admin', 'middleware' => 'admin'], function () {
        Route::get('/stats', [AdminController::class, 'stats']);
        Route::get('/users', [AdminController::class, 'users']);
        Route::get('/users/{user}', [AdminController::class, 'show']);
        Route::post('/users/{user}/update', [AdminController::class, 'update']);
        Route::put('/users/{user}', [AdminController::class, 'update']);
        Route::post('/users/{user}/password', [AdminController::class, 'changePassword']);
        Route::post('/users/{user}/impersonate', [AdminController::class, 'impersonate']);
        Route::post('/users/{user}/toggle-status', [AdminController::class, 'toggleStatus']);
        Route::delete('/users/{user}', [AdminController::class, 'destroy']);
    });

});
Route::get('/buckets/display/{bucket}/{fileId}', [BucketController::class, 'showBucketFile'])->where('fileId', '.*');

Route::get('/thumbnail/{bucket}/{id}', [FileController::class, 'thumbnail'])->name('thumbnail')->where('id', '.*');
Route::get('/stream/{bucket}/{id}', [FileController::class, 'streamFileSigned'])->name('stream.file')->where('id', '.*');
Route::get('/stream-file/{bucket}/{id}', [FileController::class, 'streamFileSigned'])->name('stream.file.signed')->where('id', '.*');
Route::get('/stream/{id}', [FileController::class, 'stream'])->name('stream.file.legacy')->where('id', '.*');
Route::get('/show/{code}', [SharedBucketController::class, 'index'])->name('shared.bucket-data');
Route::post('files/upload/{code}', [SharedBucketController::class, 'uploadFile'])->name('shared.bucket-upload');
Route::match(['get', 'post'], 'files/download/{code}/{fileId?}', [SharedBucketController::class, 'downloadFile'])->name('shared.bucket-download')->where('fileId', '.*');

Route::fallback(function () {
    return response()->json([
        'success' => false,
        'message' => 'API endpoint not found',
        'status' => 404,
    ], 404);
});
