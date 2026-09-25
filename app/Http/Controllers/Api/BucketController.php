<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\BucketRequest;
use App\Http\Requests\ShareBucketRequest;
use App\Interfaces\BucketRepositoryInterface;
use App\Models\Bucket;
use App\Services\Telegram\TelegramClient;
use App\Trait\ApiResponseTrait;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Laravel\Sanctum\PersonalAccessToken;

class BucketController extends Controller
{
    use ApiResponseTrait;

    protected $bucketRepo;

    public function __construct(BucketRepositoryInterface $bucketRepo)
    {
        $this->bucketRepo = $bucketRepo;
    }

    public function store(BucketRequest $request): JsonResponse
    {
        try {
            if (Auth::user()->bucketAllowed < 1) {
                return self::errorResponse(message: 'Insufficient Bucket Bucket balance');
            }

            return $this->bucketRepo->store($request->all()) ?
                self::successResponse(message: 'Bucket Created Successfully') :
                self::ERRORResponse(message: 'Fail to Created Bucket');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function update(BucketRequest $request, Bucket $bucket): JsonResponse
    {
        try {
            return $this->bucketRepo->update($request->all(), $bucket) ?
                    self::successResponse(message: 'Bucket Name Update Successfull') :
                    self::errorResponse(message: 'Fail to UpdateBucket Name');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function destroy(Bucket $bucket): JsonResponse
    {
        try {
            return $this->bucketRepo->destroy($bucket) ?
                    self::successResponse(message: 'Bucket Delete Successfull') :
                    self::errorResponse(message: 'Bucket Fail to Delete');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function listBuckets(): JsonResponse
    {
        $data = $this->bucketRepo->listBuckets();

        return self::successResponse(data: $data);
    }

    public function showBucketFile(TelegramClient $telegram, Bucket $bucket, $id)
    {
        try {
            // Allow public access if shared or compact signed token; otherwise enforce ownership
            $isShared = $bucket->bucketShare()->exists();
            if (! $isShared && ! isCompactSignedIdForBucket((string) $id, $bucket->id)) {
                $user = request()->user('sanctum');
                if (! $user && request()->filled('token')) {
                    $tokenModel = PersonalAccessToken::findToken(request()->query('token'));
                    if ($tokenModel) {
                        $user = $tokenModel->tokenable;
                    }
                }
                if (! $user || (int) $bucket->user_id !== (int) $user->id) {
                    abort(403, 'Unauthorized access to bucket');
                }
            }

            $msgId = safeDecryptId($id);
            if (! $msgId) {
                abort(404, 'Invalid file ID');
            }

            $meta = $telegram->getFileMeta(
                channelId: $bucket->channel_id,
                msgId: $msgId
            );

            return response()->stream(function () use ($telegram, $meta) {
                $out = fopen('php://output', 'wb');
                $telegram->client()->downloadToStream($meta['media'], $out);
                fclose($out);
            }, 200, [
                'Content-Type' => $meta['mime'],
                'Content-Disposition' => 'inline; filename="'.$meta['filename'].'"',
                'Accept-Ranges' => 'bytes',
                'Access-Control-Allow-Origin' => '*',
            ]);
        } catch (Exception $e) {
            abort(404, 'file not found');
        }
    }

    public function shareBucket(ShareBucketRequest $request): JsonResponse
    {
        try {
            $data = $this->bucketRepo->shareBucket($request->only(['bucket_id', 'password', 'expiresAt']));

            return self::successResponse(data: ['code' => $data->code], message: 'Bucket Shared Successfully');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }

    public function endShare($code): JsonResponse
    {
        try {
            $this->bucketRepo->endShare($code);

            return self::successResponse(message: 'Bucket Sharing ended!');
        } catch (Exception $e) {
            return self::errorResponse(message: $e->getMessage());
        }
    }
}
