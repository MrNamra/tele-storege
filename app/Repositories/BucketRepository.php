<?php

namespace App\Repositories;

use App\Interfaces\BucketRepositoryInterface;
use App\Models\Bucket;
use App\Models\BucketShare;
use App\Services\Telegram\TelegramClient;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class BucketRepository implements BucketRepositoryInterface
{
    protected TelegramClient $telegram;

    public function __construct(TelegramClient $telegram)
    {
        $this->telegram = $telegram;
    }

    public function store(array $data): bool
    {
        $channel = $this->telegram->createPrivateChannel($data['name']);
        $data['channel_id'] = $channel['channel_id'];
        $data['access_hash'] = $channel['access_hash'];

        self::updateOrCreateBucket($data);
        Auth::user()->decrement('bucketAllowed', 1);

        return true;
    }

    public function update(array $data, Bucket $bucket): bool
    {
        $result = $this->telegram->updateChannelName($bucket->channel_id, $data['name']);
        if ($result) {
            return self::updateOrCreateBucket($data, $bucket);
        }

        return false;
    }

    private function updateOrCreateBucket($data, $bucket = null): bool
    {
        Bucket::updateOrCreate(
            [
                'user_id' => Auth::id(),
                'id' => $bucket ? $bucket->id : null,
            ],
            [
                'bucketName' => $data['name'],
                'channel_id' => $data['channel_id'] ?? $bucket->channel_id,
                'access_hash' => $data['access_hash'] ?? $bucket->access_hash,
            ]
        );

        return true;
    }

    public function destroy(Bucket $bucket): bool
    {
        $this->telegram->deleteChannel($bucket->channel_id, $bucket->access_hash);

        $bucket->delete();

        Auth::user()->increment('bucketAllowed', 1);

        return true;
    }

    public function listBuckets(): Collection
    {
        return Bucket::select(['id', 'bucketName'])->where('user_id', Auth::id())->get();
    }

    public function shareBucket($request): BucketShare
    {
        $bucket = Bucket::firstWhere(['id' => $request['bucket_id'], 'user_id' => Auth::id()]);
        if (! $bucket) {
            abort(404);
        }

        $sharedBucket = BucketShare::firstWhere(['bucket_id' => $bucket['id']]);

        if (! $sharedBucket) {
            $sharedBucket = BucketShare::create([
                'bucket_id' => $bucket['id'],
                'password' => $request['password'] ?? null,
                'code' => Str::random(5),
            ]);
        }

        return $sharedBucket;
    }

    public function endShare($code): void
    {
        BucketShare::whereCode($code)
            ->whereHas('bucket', fn ($q) => $q->whereUserId(Auth::id()))
            ->with('bucket')
            ->delete();
    }
}
