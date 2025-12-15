<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\FileRequest;
use App\Interfaces\FileRepositoryInterface;
use App\Models\Bucket;
use App\Trait\ApiResponseTrait;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Services\Telegram\TelegramClient;
use Exception;
use Illuminate\Support\Facades\Auth;

class FileController extends Controller
{
    use ApiResponseTrait;
    protected $fileRepo;
    public function __construct(FileRepositoryInterface $fileRepo)
    {
        $this->fileRepo = $fileRepo;
    }
    public function uploadFile(FileRequest $request): JsonResponse
    {
        try {
            $bucket = Bucket::firstWhere(['user_id' => auth()->id(), 'id' => $request->bucket_id]);

            if(!$bucket) {
                return Self::errorResponse('Bucket not found / Selected');
            }

            $data = $this->fileRepo->fileUpload($request->file('files'), $bucket);

            return $data[0]['uploaded'] ?
                    Self::successResponse(message:'file(s) uplaoded successfully', data: $data) :
                    Self::errorResponse(message:'File Uplaod Failed');

        } catch (\Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function showBucketData(Request $request, Bucket $bucket): JsonResponse
    {
        try {
            $data = $this->fileRepo->bucketData($request->all(), $bucket);
            return Self::successResponse(data: $data);
        } catch (\Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
    public function streamThumb(Bucket $bucket, int $messageId)
    {
        try {

            return $this->fileRepo->streamThumbnail($bucket, $messageId);

        } catch (\Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }

    public function thumbnail(TelegramClient $telegram, Bucket $bucket, $id)
    {
        return $telegram->streamThumbnail(channelId: $bucket->channel_id, msgId: decrypt($id));
    }

    public function stream(TelegramClient $telegram, Bucket $bucket, $id)
    {
        return $telegram->streamFile(channelId: $bucket->channel_id, msgId: $id);
    }

    public function removeFile(Request $request,Bucket $bucket)
    {
        $request->validate([
            'file_id'=> 'required|array',
            'file_id.*' => 'required'
        ]);

        try {
            if(!$bucket->firstWhere('user_id', Auth::id())) {
                return Self::errorResponse(message:'Bucket or File not Find');
            }

            $this->fileRepo->deleteFiles(
                channel_id: $bucket->channel_id,
                IDs: $request->file_id
            );

            return Self::successResponse(message: 'File(s) Delete Successfully');
        } catch (Exception $e) {
            return Self::errorResponse(message: $e->getMessage());
        }
    }
}
