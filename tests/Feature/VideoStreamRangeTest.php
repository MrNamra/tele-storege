<?php

namespace Tests\Feature;

use App\Models\Bucket;
use App\Models\User;
use App\Services\Telegram\TelegramClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class VideoStreamRangeTest extends TestCase
{
    use RefreshDatabase;

    protected function createMockTelegramClient(int $fileSize = 104857600, string $mime = 'video/mp4', string $filename = 'sample_video.mp4'): TelegramClient
    {
        $media = [
            'document' => [
                'mime_type' => $mime,
                'size' => $fileSize,
                'attributes' => [
                    [
                        '_' => 'documentAttributeFilename',
                        'file_name' => $filename,
                    ],
                ],
            ],
        ];

        $mockMessages = new class($media)
        {
            public function __construct(private array $media) {}

            public function getHistory(...$args): array
            {
                return [
                    'messages' => [
                        [
                            'id' => 12345,
                            'media' => $this->media,
                        ],
                    ],
                ];
            }

            public function getMessages(...$args): array
            {
                return [
                    'messages' => [
                        [
                            'id' => 12345,
                            'media' => $this->media,
                        ],
                    ],
                ];
            }
        };

        $mockApi = new class($mockMessages)
        {
            public function __construct(public object $messages) {}

            public function downloadToStream($media, $stream, $cb = null, $offset = 0, $end = -1): void
            {
                if (is_resource($stream)) {
                    $bytesToWrite = $end > $offset ? ($end - $offset) : 1024;
                    fwrite($stream, str_repeat('X', min(1024, $bytesToWrite)));
                }
            }
        };

        $mockClient = Mockery::mock(TelegramClient::class);
        $mockClient->shouldReceive('client')->andReturn($mockApi);
        $mockClient->shouldReceive('isLoggedIn')->andReturn(true);

        return $mockClient;
    }

    public function test_video_stream_head_request_returns_accept_ranges_and_content_length(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Video Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $mockTelegram = $this->createMockTelegramClient(fileSize: 52428800);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        $res = $this->call('HEAD', "/api/stream/{$bucket->id}/12345");

        $res->assertStatus(200);
        $res->assertHeader('Accept-Ranges', 'bytes');
        $res->assertHeader('Content-Length', '52428800');
        $res->assertHeader('Content-Type', 'video/mp4');
    }

    public function test_video_stream_initial_range_returns_206_with_chunk(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Video Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $mockTelegram = $this->createMockTelegramClient(fileSize: 52428800);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        // Browser starts video playback by requesting Range: bytes=0-
        $res = $this->get("/api/stream/{$bucket->id}/12345", [
            'Range' => 'bytes=0-',
        ]);

        $res->assertStatus(206);
        $res->assertHeader('Accept-Ranges', 'bytes');
        // Default 2MB chunk window (0 to 2097151)
        $res->assertHeader('Content-Range', 'bytes 0-2097151/52428800');
        $res->assertHeader('Content-Length', '2097152');
        $res->assertHeader('Content-Type', 'video/mp4');
    }

    public function test_video_stream_specific_range_returns_exact_range(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Video Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $mockTelegram = $this->createMockTelegramClient(fileSize: 52428800);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        // Specific range: byte 1048576 to 2097151 (1MB chunk)
        $res = $this->get("/api/stream/{$bucket->id}/12345", [
            'Range' => 'bytes=1048576-2097151',
        ]);

        $res->assertStatus(206);
        $res->assertHeader('Accept-Ranges', 'bytes');
        $res->assertHeader('Content-Range', 'bytes 1048576-2097151/52428800');
        $res->assertHeader('Content-Length', '1048576');
    }

    public function test_video_stream_suffix_range_for_moov_atom(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Video Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $fileSize = 10000000;
        $mockTelegram = $this->createMockTelegramClient(fileSize: $fileSize);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        // Suffix range: last 500,000 bytes
        $res = $this->get("/api/stream/{$bucket->id}/12345", [
            'Range' => 'bytes=-500000',
        ]);

        $res->assertStatus(206);
        $res->assertHeader('Accept-Ranges', 'bytes');
        $res->assertHeader('Content-Range', 'bytes 9500000-9999999/10000000');
        $res->assertHeader('Content-Length', '500000');
    }

    public function test_video_stream_out_of_bounds_range_returns_416(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Video Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $fileSize = 10000000;
        $mockTelegram = $this->createMockTelegramClient(fileSize: $fileSize);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        // Range starting beyond file size
        $res = $this->get("/api/stream/{$bucket->id}/12345", [
            'Range' => 'bytes=20000000-',
        ]);

        $res->assertStatus(416);
        $res->assertHeader('Content-Range', 'bytes */10000000');
    }

    public function test_video_stream_without_range_returns_200_with_accept_ranges(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Video Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $fileSize = 15000000;
        $mockTelegram = $this->createMockTelegramClient(fileSize: $fileSize);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        $res = $this->get("/api/stream/{$bucket->id}/12345");

        $res->assertStatus(200);
        $res->assertHeader('Accept-Ranges', 'bytes');
        $res->assertHeader('Content-Length', '15000000');
        $res->assertHeader('Content-Type', 'video/mp4');
    }

    public function test_compact_short_url_stream_works_without_token(): void
    {
        $user = User::factory()->create();

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Short URL Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $mockTelegram = $this->createMockTelegramClient(fileSize: 10000000);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        // Generate compact encrypted ID bound to this bucket
        $compactId = safeEncryptId(12345, $bucket->id);
        $this->assertEquals(22, strlen($compactId)); // Exactly 22 chars!

        // Decrypts cleanly with zero DB
        $this->assertEquals(12345, safeDecryptId($compactId));

        // Call short URL /s/{bucket}/{compactId} with Range header - no auth token param needed!
        $res = $this->get("/s/{$bucket->id}/{$compactId}", [
            'Range' => 'bytes=0-',
        ]);

        $res->assertStatus(206);
        $res->assertHeader('Accept-Ranges', 'bytes');
        $res->assertHeader('Content-Length', '2097152');
    }

    public function test_compact_short_url_rejected_if_used_with_wrong_bucket(): void
    {
        $user = User::factory()->create();

        $bucket1 = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Bucket 1',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $bucket2 = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Bucket 2',
            'channel_id' => '-100987654321',
            'access_hash' => 'hash456',
        ]);

        // Token generated for bucket 1
        $compactId = safeEncryptId(12345, $bucket1->id);

        // Accessing bucket 2 with bucket 1 token is forbidden (tamper-proof!)
        $res = $this->get("/s/{$bucket2->id}/{$compactId}");
        $res->assertStatus(403);
    }

    public function test_options_preflight_on_stream_returns_204_with_cors_headers(): void
    {
        $user = User::factory()->create();

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Cors Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $compactId = safeEncryptId(12345, $bucket->id);

        $res = $this->call('OPTIONS', "/s/{$bucket->id}/{$compactId}");
        $res->assertStatus(204);
        $res->assertHeader('Access-Control-Allow-Origin', '*');
        $res->assertHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    }

    public function test_video_seeking_returns_only_target_range_without_loading_from_start(): void
    {
        $user = User::factory()->create();

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Seek Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        // 100MB video file
        $mockTelegram = $this->createMockTelegramClient(fileSize: 104857600);
        $this->app->instance(TelegramClient::class, $mockTelegram);

        $compactId = safeEncryptId(12345, $bucket->id);

        // User seeks to ~50s (byte offset 80,000,000)
        $res = $this->get("/s/{$bucket->id}/{$compactId}", [
            'Range' => 'bytes=80000000-',
        ]);

        $res->assertStatus(206);
        $res->assertHeader('Accept-Ranges', 'bytes');
        // Chunk window of 2MB starting at 80,000,000, skipping 0-79,999,999 completely!
        $res->assertHeader('Content-Range', 'bytes 80000000-82097151/104857600');
        $res->assertHeader('Content-Length', '2097152');
    }
}
