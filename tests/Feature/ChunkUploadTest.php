<?php

namespace Tests\Feature;

use App\Models\Bucket;
use App\Models\BucketShare;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ChunkUploadTest extends TestCase
{
    use RefreshDatabase;

    public function test_chunk_upload_init_and_resumability(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Test Bucket',
            'channel_id' => '-100123456789',
            'access_hash' => 'hash123',
        ]);

        $payload = [
            'bucket_id' => $bucket->id,
            'file_name' => 'sample_video.mp4',
            'file_size' => 15728640, // 15MB
            'total_chunks' => 3,
            'chunk_size' => 5242880,
            'file_identifier' => 'sample_video.mp4_15728640_1700000000',
        ];

        // 1. First init: no chunks uploaded yet
        $res = $this->postJson('/api/upload/init', $payload);
        $res->assertStatus(200);
        $res->assertJsonPath('success', true);
        $res->assertJsonPath('data.total_chunks', 3);
        $res->assertJsonPath('data.uploaded_chunks', []);
        $res->assertJsonPath('data.resumed', false);

        $uploadId = $res->json('data.upload_id');
        $this->assertNotEmpty($uploadId);

        // 2. Upload chunk 0
        $chunk0 = UploadedFile::fake()->createWithContent('chunk_0', str_repeat('A', 1024));
        $chunkRes = $this->post('/api/upload/chunk', [
            'upload_id' => $uploadId,
            'chunk_index' => 0,
            'chunk' => $chunk0,
        ]);
        $chunkRes->assertStatus(200);
        $chunkRes->assertJsonPath('data.chunk_index', 0);

        // 3. Upload chunk 1
        $chunk1 = UploadedFile::fake()->createWithContent('chunk_1', str_repeat('B', 1024));
        $chunkRes1 = $this->post('/api/upload/chunk', [
            'upload_id' => $uploadId,
            'chunk_index' => 1,
            'chunk' => $chunk1,
        ]);
        $chunkRes1->assertStatus(200);

        // 4. Second init for SAME file (resuming): server returns uploaded_chunks: [0, 1]
        $resumeRes = $this->postJson('/api/upload/init', $payload);
        $resumeRes->assertStatus(200);
        $resumeRes->assertJsonPath('data.uploaded_chunks', [0, 1]);
        $resumeRes->assertJsonPath('data.resumed', true);

        // Clean up
        $this->postJson("/api/upload/cancel/{$uploadId}");
    }

    public function test_shared_bucket_chunk_upload_with_password(): void
    {
        $user = User::factory()->create();
        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Shared Bucket',
            'channel_id' => '-100987654321',
            'access_hash' => 'hash456',
        ]);

        $share = BucketShare::create([
            'bucket_id' => $bucket->id,
            'code' => 'secretshare',
            'password' => 'mypassword123',
        ]);

        $payload = [
            'code' => 'secretshare',
            'password' => 'wrongpass',
            'file_name' => 'document.pdf',
            'file_size' => 2048,
            'total_chunks' => 1,
            'file_identifier' => 'doc_2048_1700000000',
        ];

        // Wrong password rejected with 403
        $res = $this->postJson('/api/upload/init', $payload);
        $res->assertStatus(403);
        $res->assertJsonPath('message', 'Password is wrong!');

        // Correct password accepted
        $payload['password'] = 'mypassword123';
        $res2 = $this->postJson('/api/upload/init', $payload);
        $res2->assertStatus(200);
        $uploadId = $res2->json('data.upload_id');

        // Cancel and clean
        $this->postJson("/api/upload/cancel/{$uploadId}");
    }

    public function test_chunk_upload_assembly_and_status(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Assembly Bucket',
            'channel_id' => '-10011223344',
            'access_hash' => 'hash789',
        ]);

        $initRes = $this->postJson('/api/upload/init', [
            'bucket_id' => $bucket->id,
            'file_name' => 'test_file.txt',
            'file_size' => 20,
            'total_chunks' => 2,
            'chunk_size' => 10,
            'file_identifier' => 'test_file.txt_20_1700000000',
        ]);
        $uploadId = $initRes->json('data.upload_id');

        // Upload chunk 0
        $chunk0 = UploadedFile::fake()->createWithContent('chunk_0', '0123456789');
        $this->post('/api/upload/chunk', [
            'upload_id' => $uploadId,
            'chunk_index' => 0,
            'chunk' => $chunk0,
        ])->assertStatus(200);

        // Upload chunk 1
        $chunk1 = UploadedFile::fake()->createWithContent('chunk_1', 'abcdefghij');
        $this->post('/api/upload/chunk', [
            'upload_id' => $uploadId,
            'chunk_index' => 1,
            'chunk' => $chunk1,
        ])->assertStatus(200);

        // Complete upload
        $completeRes = $this->postJson('/api/upload/complete', [
            'upload_id' => $uploadId,
        ]);
        $completeRes->assertStatus(200);
        $completeRes->assertJsonPath('data.status', 'processing');

        // Check status endpoint
        $statusRes = $this->getJson("/api/upload/status/{$uploadId}");
        $statusRes->assertStatus(200);
        $statusRes->assertJsonPath('data.status', 'processing');

        // Clean up
        $this->postJson("/api/upload/cancel/{$uploadId}");
    }

    public function test_shared_bucket_upload_async(): void
    {
        $user = User::factory()->create();
        $bucket = Bucket::create([
            'user_id' => $user->id,
            'bucketName' => 'Async Shared Bucket',
            'channel_id' => '-10099887766',
            'access_hash' => 'hash_async',
        ]);

        $share = BucketShare::create([
            'bucket_id' => $bucket->id,
            'code' => 'SHORTCUT1',
            'password' => 'pass123',
            'expires_at' => now()->addDay(),
        ]);

        $file = UploadedFile::fake()->create('photo.jpg', 500, 'image/jpeg');

        $res = $this->post('/api/files/upload/SHORTCUT1?async=1', [
            'password' => 'pass123',
            'files' => [$file],
        ]);

        $res->assertStatus(200);
        $res->assertJsonPath('data.status', 'processing');
        $this->assertNotEmpty($res->json('data.upload_ids'));
    }
}
