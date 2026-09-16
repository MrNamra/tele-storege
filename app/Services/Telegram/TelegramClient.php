<?php

namespace App\Services\Telegram;

use App\Models\BucketShare;
use danog\MadelineProto\API;
use danog\MadelineProto\Settings;
use Illuminate\Support\Facades\Log;

class TelegramClient
{
    protected API $MadelineProto;

    protected bool $started = false;

    public function __construct()
    {
        $session = storage_path('telegram/session.madeline');
        $sessionDir = dirname($session);
        if (! is_dir($sessionDir)) {
            @mkdir($sessionDir, 0775, true);
        }

        $settings = new Settings;
        $appInfo = $settings->getAppInfo();
        $apiId = (int) (config('services.telegram.api_id') ?: env('TELEGRAM_API_ID', 27622442));
        $apiHash = (string) (config('services.telegram.api_hash') ?: env('TELEGRAM_API_HASH', 'd21311e9010f410a84606f286a45939a'));

        if ($apiId && $apiHash) {
            $appInfo->setApiId($apiId);
            $appInfo->setApiHash($apiHash);
        }
        $appInfo->setShowPrompt(false);

        // Initialize MadelineProto instance
        $this->MadelineProto = new API($session, $settings);
    }

    public function getAuthorization(): int
    {
        try {
            return $this->MadelineProto->getAuthorization();
        } catch (\Throwable $e) {
            return API::NOT_LOGGED_IN;
        }
    }

    public function isLoggedIn(): bool
    {
        return $this->getAuthorization() === API::LOGGED_IN;
    }

    public function startInteractiveLogin(): array
    {
        $this->started = true;

        return $this->MadelineProto->start();
    }

    public function connect(): array
    {
        return $this->startInteractiveLogin();
    }

    protected function ensureStarted(): void
    {
        if (! $this->started) {
            $this->started = true;
            if ($this->isLoggedIn()) {
                try {
                    $this->MadelineProto->start();
                } catch (\Throwable $e) {
                    Log::warning('MadelineProto start: '.$e->getMessage());
                }
            }
        }
    }

    public function client(): API
    {
        $this->ensureStarted();
        if (! $this->isLoggedIn()) {
            throw new \Exception("Telegram session is not logged in. Please run 'php artisan telegram:login' in your terminal to connect your Telegram account.");
        }

        return $this->MadelineProto;
    }

    public function createPrivateChannel(string $name): array
    {
        $result = self::client()->channels->createChannel(
            broadcast: true,
            megagroup: false,
            title: $name,
            // about: 'Bucket Storage Private Channel'
        );

        $channel = $result['chats'][0];

        // Get full channel information
        $fullInfo = $this->client()->getFullInfo($channel['id']);

        $accessHash = $fullInfo['Chat']['access_hash'] ?? null;

        return [
            'channel_id' => $channel['id'],
            'access_hash' => $accessHash,
        ];
    }

    public function updateChannelName(string $channelId, string $newName): bool
    {
        // Get full info first
        $fullInfo = $this->client()->getFullInfo($channelId);

        if (! isset($fullInfo['Chat'])) {
            Log::error("Cannot fetch channel info for ID: {$channelId}");

            return false;
        }

        $accessHash = $fullInfo['Chat']['access_hash'];

        // Update the channel title
        $da = $this->client()->channels->editTitle(channel: $channelId, title: $newName);

        return true;
    }

    public function deleteChannel(string $channelId, string $accessHash)
    {
        try {
            // get all channel messages
            // $chat = $this->client()->getPwrChat((int) $channelId);

            // delete all messages from channel
            $this->client()->channels->deleteMessages(
                channel: $channelId,
                id: []
            );

            // leave from channel
            $this->client()->channels->leaveChannel(channel: $channelId);

            return true;
        } catch (\Exception $e) {
            throw new \Exception($e->getMessage(), $e->getCode(), $e);
        }
    }

    public function old_uploadFileToChannel(string $channelId, $file, string $originalName): array
    {
        $mime = mime_content_type(stream_get_meta_data($file)['uri']);

        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

        if (str_starts_with($mime, 'image/') && in_array($extension, ['jpg', 'jpeg'])) {
            $media = [
                '_' => 'inputMediaUploadedPhoto',
                'file' => $file,
            ];
        } else {
            // Document for PNG, WEBP, HEIC, PDF, ZIP, VIDEO, AUDIO etc
            $type = 'inputMediaUploadedDocument';

            $attributes = [
                ['_' => 'documentAttributeFilename', 'file_name' => $originalName],
            ];

            // Video attributes
            if (str_starts_with($mime, 'video/')) {
                $attributes[] = [
                    '_' => 'documentAttributeVideo',
                    'supports_streaming' => true,
                ];
            }

            if (str_starts_with($mime, 'audio/')) {
                $attributes[] = [
                    '_' => 'documentAttributeAudio',
                    'voice' => false,
                ];
            }

            $media = [
                '_' => $type,
                'file' => $file,
                'mime_type' => $mime,
                'attributes' => $attributes,
            ];
        }

        $response = $this->client()->messages->sendMedia(
            silent: false,
            background: false,
            clear_draft: true,
            noforwards: false,
            peer: $channelId,
            media: $media
        );

        return $response;
    }

    public function uploadFileToChannel(string $channelId, $file, string $originalName, ?callable $progressCallback = null)
    {
        $realPath = is_object($file) && method_exists($file, 'getRealPath') ? $file->getRealPath() : (string) $file;
        $mimeType = is_object($file) && method_exists($file, 'getMimeType')
            ? $file->getMimeType()
            : (function_exists('mime_content_type') && file_exists($realPath) ? (mime_content_type($realPath) ?: 'application/octet-stream') : 'application/octet-stream');

        // 1. Upload main file to Telegram (with optional progress callback for chunked / large uploads)
        $inputFile = $this->client()->upload($realPath, $originalName, $progressCallback);

        $attributes = [
            [
                '_' => 'documentAttributeFilename',
                'file_name' => $originalName,
            ],
        ];

        $mediaPayload = [
            '_' => 'inputMediaUploadedDocument',
            'file' => $inputFile,
            'mime_type' => $mimeType,
        ];

        $tempThumb = null;
        $isImage = str_starts_with($mimeType, 'image/');

        if ($isImage) {
            if ($size = @getimagesize($realPath)) {
                [$w, $h] = $size;
                $attributes[] = [
                    '_' => 'documentAttributeImageSize',
                    'w' => $w,
                    'h' => $h,
                ];
            }

            // Generate a lightweight, high-quality compressed thumbnail (~15-25 KB)
            $tempThumb = tempnam(sys_get_temp_dir(), 'tg_thumb_').'.jpg';
            if (generateThumbnail($realPath, $tempThumb, 320, 320, 75)) {
                try {
                    $mediaPayload['thumb'] = $this->client()->upload($tempThumb, 'thumb.jpg');
                } catch (\Throwable $e) {
                    Log::warning('Thumbnail upload to Telegram failed: '.$e->getMessage());
                }
            }
        } elseif (str_starts_with($mimeType, 'video/') || in_array(strtolower(pathinfo($originalName, PATHINFO_EXTENSION)), ['mov', 'mp4', 'm4v', 'mkv', 'webm', 'avi', '3gp', 'flv', 'wmv'])) {
            $attributes[] = [
                '_' => 'documentAttributeVideo',
                'supports_streaming' => true,
            ];

            // Extract lightweight video thumbnail frame (~15KB) and upload directly to Telegram
            $ffmpeg = getFfmpegPath();
            if ($ffmpeg) {
                $tempThumb = tempnam(sys_get_temp_dir(), 'tg_vthumb_').'.jpg';
                $thumbCmd = escapeshellcmd($ffmpeg).' -i '.escapeshellarg($realPath).' -ss 0 -vframes 1 -vf "scale=320:-1" -q:v 3 '.escapeshellarg($tempThumb).' 2>&1';
                @exec($thumbCmd, $tOut, $tCode);
                if ($tCode === 0 && file_exists($tempThumb) && filesize($tempThumb) > 0) {
                    try {
                        $mediaPayload['thumb'] = $this->client()->upload($tempThumb, 'thumb.jpg');
                    } catch (\Throwable $e) {
                        Log::warning('Video thumb upload to Telegram failed: '.$e->getMessage());
                    } finally {
                        if (file_exists($tempThumb)) {
                            @unlink($tempThumb);
                        }
                    }
                }
            }
        } elseif (str_starts_with($mimeType, 'audio/')) {
            $attributes[] = [
                '_' => 'documentAttributeAudio',
                'voice' => false,
            ];
        }

        $mediaPayload['attributes'] = $attributes;

        $response = $this->client()->messages->sendMedia(
            peer: $channelId,
            media: $mediaPayload
        );

        if ($tempThumb && file_exists($tempThumb)) {
            @unlink($tempThumb);
        }

        return $response;
    }

    public function getChannelFiles(string $channelId, string $bucket_id, int $page = 1, int $perPage = 15): array
    {
        $page = max(1, $page);
        $perPage = max(1, min(100, $perPage));

        $emptyResponse = [
            'files' => [],
            'pagination' => [
                'currentPage' => $page,
                'perPage' => $perPage,
                'totalFiles' => 0,
                'totalPages' => 1,
            ],
            'totalStorage' => 0,
        ];

        $history = null;
        try {
            $history = $this->client()->messages->getHistory(
                peer: $channelId,
                add_offset: ($page - 1) * $perPage,
                limit: $perPage
            );
        } catch (\Throwable $e) {
            Log::warning("getChannelFiles getHistory failed for channel {$channelId}: ".$e->getMessage());

            return $emptyResponse;
        }

        if (! $history || empty($history['messages'])) {
            return $emptyResponse;
        }

        $files = [];
        $totalStorageBytes = 0;
        $isShared = BucketShare::where('bucket_id', $bucket_id)->exists();
        $token = request()->bearerToken() ?? request()->query('token');
        $tokenParam = (! $isShared && $token) ? ('?token='.urlencode($token)) : '';

        $cleanChannelId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $channelId);
        $thumbDir = storage_path('app/thumbnails');
        if (! is_dir($thumbDir)) {
            @mkdir($thumbDir, 0775, true);
        }
        $ttl = (int) config('services.telegram.cache_ttl', 7200);
        self::scheduleShutdownPrune();

        foreach ($history['messages'] as $msg) {
            if (! isset($msg['media'])) {
                continue;
            }

            $media = $msg['media'];
            $encId = safeEncryptId($msg['id']);

            // Pre-inflate stripped thumbnail on-the-fly (<0.1ms, zero network calls, zero RAM)
            $preCachePath = "{$thumbDir}/thumb_{$cleanChannelId}_{$msg['id']}.jpg";
            if (file_exists($preCachePath) && (time() - filemtime($preCachePath) > $ttl)) {
                @unlink($preCachePath);
            }
            if (! file_exists($preCachePath) || filesize($preCachePath) === 0) {
                $strippedJpeg = null;
                if (isset($media['photo']['sizes'])) {
                    $strippedJpeg = extractStrippedJpeg($media['photo']['sizes']);
                } elseif (isset($media['document']['thumbs'])) {
                    $strippedJpeg = extractStrippedJpeg($media['document']['thumbs']);
                }
                if ($strippedJpeg) {
                    @file_put_contents($preCachePath, $strippedJpeg);
                }
            }

            $file = [
                'msg_id' => $encId,
                'date' => $msg['date'],
                'type' => null,
                'file_name' => null,
                'mime_type' => null,
                'size' => null,
                'thumbnail' => url("/api/thumbnail/{$bucket_id}/{$encId}").$tokenParam,
                'stream_url' => url("/api/stream/{$bucket_id}/{$encId}").$tokenParam,
            ];

            /** PHOTO */
            if (isset($media['photo'])) {
                $file['type'] = 'photo';
                $file['mime_type'] = 'image/jpeg';
                $file['file_name'] = 'photo_'.$msg['id'].'.jpg';
                if (! empty($media['photo']['sizes'])) {
                    $largest = end($media['photo']['sizes']);
                    $file['size'] = $largest['size'] ?? null;
                    if ($file['size']) {
                        $totalStorageBytes += (int) $file['size'];
                    }
                }
                $files[] = $file;

                continue;
            }

            /** DOCUMENT (PDF, VIDEO, ZIP, AUDIO, PNG, etc.) */
            if (isset($media['document'])) {
                $doc = $media['document'];

                $file['type'] = 'document';
                $file['mime_type'] = $doc['mime_type'] ?? null;
                $file['size'] = $doc['size'] ?? null;
                if ($file['size']) {
                    $totalStorageBytes += (int) $file['size'];
                }

                if (! empty($doc['attributes'])) {
                    foreach ($doc['attributes'] as $attr) {
                        if ($attr['_'] === 'documentAttributeFilename') {
                            $file['file_name'] = $attr['file_name'];
                        }
                        if ($attr['_'] === 'documentAttributeVideo') {
                            $file['type'] = 'video';
                        }
                        if ($attr['_'] === 'documentAttributeAudio') {
                            $file['type'] = 'audio';
                        }
                    }
                }

                if (empty($file['file_name'])) {
                    $file['file_name'] = 'file_'.$msg['id'];
                }

                $files[] = $file;
            }
        }

        // Calculate pagination metadata accurately
        $rawCount = isset($history['count']) ? (int) $history['count'] : null;
        if ($rawCount !== null) {
            $estimatedFiles = max(0, $rawCount - 1);
            if ($page === 1 && count($files) < $perPage && $rawCount <= count($files) + 1) {
                $totalFiles = count($files);
            } else {
                $totalFiles = max(count($files), $estimatedFiles);
            }
            $totalPages = $totalFiles > 0 ? (int) ceil($totalFiles / $perPage) : 1;
        } else {
            if (count($files) === $perPage) {
                $totalFiles = ($page * $perPage) + 1;
                $totalPages = $page + 1;
            } else {
                $totalFiles = (($page - 1) * $perPage) + count($files);
                $totalPages = max(1, $page);
            }
        }

        $totalStorageMB = round($totalStorageBytes / (1024 * 1024), 2);

        return [
            'files' => $files,
            'pagination' => [
                'currentPage' => $page,
                'perPage' => $perPage,
                'totalFiles' => $totalFiles,
                'totalPages' => $totalPages,
            ],
            'totalStorage' => $totalStorageMB,
        ];
    }

    public function getFileMeta(int|string $channelId, int $msgId): array
    {
        $result = $this->client()->messages->getHistory(
            peer: $channelId,
            offset_id: $msgId + 1,
            limit: 1
        );

        $message = $result['messages'][0] ?? null;

        if (! $message || empty($message['media'])) {
            throw new \Exception('No media found');
        }

        $media = $message['media'];

        if (isset($media['photo'])) {
            return [
                'mime' => 'image/jpeg',
                'filename' => 'image.jpg',
                'media' => $media,
            ];
        }

        if (isset($media['document'])) {
            $filename = 'file';

            foreach ($media['document']['attributes'] as $attr) {
                if ($attr['_'] === 'documentAttributeFilename') {
                    $filename = $attr['file_name'];
                }
            }

            return [
                'mime' => $media['document']['mime_type'] ?? 'application/octet-stream',
                'filename' => $filename,
                'media' => $media,
            ];
        }

        throw new \Exception('Unsupported media');
    }

    public function serveFallbackThumbnail(?string $mime = null)
    {
        $color = '#6366f1';
        $label = 'FILE';
        if ($mime) {
            if (str_starts_with($mime, 'video/')) {
                $color = '#ef4444';
                $label = 'VIDEO';
            } elseif (str_starts_with($mime, 'audio/')) {
                $color = '#8b5cf6';
                $label = 'AUDIO';
            } elseif (str_contains($mime, 'pdf')) {
                $color = '#dc2626';
                $label = 'PDF';
            } elseif (str_contains($mime, 'zip') || str_contains($mime, 'compressed') || str_contains($mime, 'tar')) {
                $color = '#f59e0b';
                $label = 'ZIP';
            }
        }

        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
  <rect width="160" height="160" rx="16" fill="#f8fafc"/>
  <rect x="25" y="20" width="110" height="120" rx="12" fill="white" stroke="#e2e8f0" stroke-width="2"/>
  <rect x="40" y="36" width="80" height="38" rx="8" fill="'.$color.'" opacity="0.12"/>
  <text x="80" y="60" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="'.$color.'" text-anchor="middle" letter-spacing="1">'.$label.'</text>
  <circle cx="80" y="104" r="16" fill="'.$color.'"/>
  <path d="M75 96 L89 104 L75 112 Z" fill="white"/>
</svg>';

        return response($svg, 200, [
            'Content-Type' => 'image/svg+xml',
            'Cache-Control' => 'public, max-age=604800, immutable',
        ]);
    }

    public function streamThumbnail(int|string $channelId, int $msgId)
    {
        // 1. Fetch message from Telegram
        $msg = null;
        try {
            $history = $this->client()->messages->getHistory(
                peer: $channelId,
                offset_id: $msgId + 1,
                limit: 1
            );
            $msg = $history['messages'][0] ?? null;
        } catch (\Throwable $e) {
            Log::warning("streamThumbnail getHistory failed for channel {$channelId}, msg {$msgId}: ".$e->getMessage());
        }

        if (! $msg || empty($msg['media'])) {
            try {
                $res = $this->client()->messages->getMessages([
                    'peer' => $channelId,
                    'id' => [$msgId],
                ]);
                $msg = $res['messages'][0] ?? null;
            } catch (\Throwable $e) {
            }
        }

        if (! $msg || empty($msg['media'])) {
            return $this->serveFallbackThumbnail();
        }

        $media = $msg['media'];
        $mime = $media['document']['mime_type'] ?? (isset($media['photo']) ? 'image/jpeg' : '');

        // 2. Memory-only stripped thumbnail from Telegram (0 bytes written to server disk)
        $strippedJpeg = null;
        if (isset($media['photo']['sizes'])) {
            $strippedJpeg = extractStrippedJpeg($media['photo']['sizes']);
        } elseif (isset($media['document']['thumbs'])) {
            $strippedJpeg = extractStrippedJpeg($media['document']['thumbs']);
        }
        if ($strippedJpeg) {
            return response($strippedJpeg, 200, [
                'Content-Type' => 'image/jpeg',
                'Cache-Control' => 'public, max-age=604800, immutable',
                'Access-Control-Allow-Origin' => '*',
            ]);
        }

        // 3. Pre-generated thumbnail in Telegram Cloud (streamed directly to response, 0 server disk storage)
        $thumbs = $media['document']['thumbs'] ?? $media['photo']['sizes'] ?? [];
        $thumb = pickBestThumb($thumbs);

        if ($thumb && ($thumb['_'] ?? '') === 'photoSize') {
            $isDoc = isset($media['document']);
            $target = $isDoc ? $media['document'] : $media['photo'];
            $loc = [
                '_' => $isDoc ? 'inputDocumentFileLocation' : 'inputPhotoFileLocation',
                'id' => $target['id'],
                'access_hash' => $target['access_hash'],
                'file_reference' => $target['file_reference'],
                'thumb_size' => $thumb['type'] ?? 'm',
            ];
            if (isset($target['dc_id'])) {
                $loc['dc_id'] = $target['dc_id'];
            }

            return response()->stream(function () use ($loc) {
                $out = fopen('php://output', 'wb');
                try {
                    $this->client()->downloadToStream(['InputFileLocation' => $loc], $out);
                } catch (\Throwable $e) {
                    Log::warning('streamThumbnail downloadToStream failed: '.$e->getMessage());
                } finally {
                    if (is_resource($out)) {
                        fclose($out);
                    }
                }
            }, 200, [
                'Content-Type' => 'image/jpeg',
                'Cache-Control' => 'public, max-age=604800, immutable',
                'Access-Control-Allow-Origin' => '*',
            ]);
        }

        // 4. Video on-the-fly frame stream (if video was transcoded on server, stream 1 frame without saving thumbnail to disk)
        $cleanChannelId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $channelId);
        $cachedMp4 = storage_path("app/video_cache/video_{$cleanChannelId}_{$msgId}.mp4");
        $ffmpeg = getFfmpegPath();
        if ($ffmpeg && file_exists($cachedMp4) && filesize($cachedMp4) > 0) {
            return response()->stream(function () use ($ffmpeg, $cachedMp4) {
                $cmd = escapeshellcmd($ffmpeg).' -i '.escapeshellarg($cachedMp4).' -ss 0 -vframes 1 -vf "scale=320:-1" -q:v 3 -f image2 pipe:1 2>/dev/null';
                $proc = popen($cmd, 'r');
                if ($proc) {
                    fpassthru($proc);
                    pclose($proc);
                }
            }, 200, [
                'Content-Type' => 'image/jpeg',
                'Cache-Control' => 'public, max-age=604800, immutable',
                'Access-Control-Allow-Origin' => '*',
            ]);
        }

        // 5. Fallback badge (Instant SVG, 0 disk storage)
        return $this->serveFallbackThumbnail($mime);
    }

    public function streamFile(string $channelId, int $msgId, $stream = null)
    {
        $message = null;
        try {
            $history = $this->client()->messages->getHistory(
                peer: $channelId,
                offset_id: $msgId + 1,
                limit: 1
            );
            $message = $history['messages'][0] ?? null;
        } catch (\Throwable $e) {
            Log::warning('streamFile getHistory failed: '.$e->getMessage());
        }

        if (! $message || empty($message['media'])) {
            $result = $this->client()->messages->getMessages([
                'peer' => $channelId,
                'id' => [$msgId],
            ]);
            $message = $result['messages'][0] ?? null;
        }

        if (! $message || empty($message['media'])) {
            throw new \Exception('No media found');
        }

        $media = $message['media'];

        // Detect mime type
        if (isset($media['photo'])) {
            $mime = 'image/jpeg';
            $filename = 'photo_'.$msgId.'.jpg';
        } elseif (isset($media['document'])) {
            $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
            $filename = 'file_'.$msgId;
            foreach ($media['document']['attributes'] ?? [] as $attr) {
                if ($attr['_'] === 'documentAttributeFilename') {
                    $filename = $attr['file_name'];
                    break;
                }
            }
        } else {
            $mime = 'application/octet-stream';
            $filename = 'file_'.$msgId;
        }

        $this->client()->downloadToStream($media, $stream);

        return compact('mime', 'filename');
    }

    public function deleteFiles(int|string $channel_id, $IDs)
    {
        $IDs = array_map(fn ($id) => safeDecryptId($id) ?? decrypt($id), $IDs);

        $this->client()->channels->deleteMessages(
            channel: $channel_id,
            id: $IDs
        );

        return true;
    }

    public function downlaodFiles($file, $channel_id)
    {
        $msgId = safeDecryptId($file) ?? (is_numeric($file) ? (int) $file : decrypt($file));
        $history = $this->client()->messages->getHistory(
            peer: $channel_id,
            offset_id: $msgId + 1,
            limit: 1
        );

        $message = $history['messages'][0] ?? null;

        if (! $message || empty($message['media'])) {
            abort(404, 'File not found');
        }

        $media = $message['media'];

        if (isset($media['photo'])) {
            $mime = 'image/jpeg';
            $filename = 'photo_'.$msgId.'.jpg';
        } elseif (isset($media['document'])) {
            $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
            $filename = 'file_'.$msgId;
            foreach ($media['document']['attributes'] ?? [] as $attr) {
                if ($attr['_'] === 'documentAttributeFilename') {
                    $filename = $attr['file_name'];
                    break;
                }
            }
        } else {
            abort(404, 'Unsupported media');
        }

        return response()->stream(function () use ($media) {
            $out = fopen('php://output', 'wb');
            $this->client()->downloadToStream($media, $out);
            fclose($out);
        }, 200, [
            'Content-Type' => $mime,
            'Content-Disposition' => 'attachment; filename="'.addcslashes($filename, '"').'"; filename*=UTF-8\'\''.rawurlencode($filename),
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => 'no-store',
            'Access-Control-Allow-Origin' => '*',
            'Access-Control-Expose-Headers' => 'Content-Disposition, Content-Type, Content-Length',
        ]);
    }

    /**
     * Prune expired thumbnail and media cache files from storage and system temp directory.
     *
     * @param  int|null  $ttl  Max age in seconds (defaults to config or 7200s / 2 hours)
     * @return array{deleted: int, bytes: int}
     */
    public static function pruneExpiredCache(?int $ttl = null): array
    {
        $ttl = $ttl ?? (int) config('services.telegram.cache_ttl', 7200);
        $now = time();
        $deletedCount = 0;
        $bytesFreed = 0;

        $targetDirs = [
            storage_path('app/thumbnails'),
            storage_path('app/heic_cache'),
            storage_path('app/video_cache'),
            storage_path('app/temp_uploads'),
        ];

        foreach ($targetDirs as $dir) {
            if (! is_dir($dir)) {
                continue;
            }
            $files = @scandir($dir) ?: [];
            foreach ($files as $file) {
                if ($file === '.' || $file === '..' || $file === '.gitignore') {
                    continue;
                }
                $fullPath = $dir.DIRECTORY_SEPARATOR.$file;
                if (! is_file($fullPath)) {
                    continue;
                }

                $mtime = @filemtime($fullPath);
                if ($mtime !== false && ($ttl === 0 || ($now - $mtime) >= $ttl)) {
                    $size = @filesize($fullPath) ?: 0;
                    if (@unlink($fullPath)) {
                        $deletedCount++;
                        $bytesFreed += $size;
                    }
                }
            }
        }

        // Clean stale chunk upload directories (older than 24h or ttl)
        $chunksDir = storage_path('app/chunks');
        if (is_dir($chunksDir)) {
            $chunkSubDirs = @scandir($chunksDir) ?: [];
            foreach ($chunkSubDirs as $subDir) {
                if ($subDir === '.' || $subDir === '..' || $subDir === '.gitignore') {
                    continue;
                }
                $subDirPath = $chunksDir.DIRECTORY_SEPARATOR.$subDir;
                if (! is_dir($subDirPath)) {
                    continue;
                }

                $mtime = @filemtime($subDirPath);
                if ($mtime !== false && ($ttl === 0 || ($now - $mtime) >= max($ttl, 86400))) {
                    $chunkFiles = @scandir($subDirPath) ?: [];
                    foreach ($chunkFiles as $cf) {
                        if ($cf === '.' || $cf === '..') {
                            continue;
                        }
                        $cfPath = $subDirPath.DIRECTORY_SEPARATOR.$cf;
                        $size = @filesize($cfPath) ?: 0;
                        if (@unlink($cfPath)) {
                            $deletedCount++;
                            $bytesFreed += $size;
                        }
                    }
                    @rmdir($subDirPath);
                }
            }
        }

        // Clean system temp directory for orphan MadelineProto/converter temporary files
        $tempDir = sys_get_temp_dir();
        $tempPatterns = ['tg_thumb_*', 'tg_doc_thumb_*', 'tg_heic_*', 'heic_thumb_*', 'tg_video_*', 'video_tmp_*'];
        foreach ($tempPatterns as $pattern) {
            $tempFiles = glob($tempDir.DIRECTORY_SEPARATOR.$pattern) ?: [];
            foreach ($tempFiles as $file) {
                if (! is_file($file)) {
                    continue;
                }
                $mtime = @filemtime($file);
                $tempTtl = $ttl === 0 ? 0 : min($ttl, 3600);
                if ($mtime !== false && ($ttl === 0 || ($now - $mtime) >= $tempTtl)) {
                    $size = @filesize($file) ?: 0;
                    if (@unlink($file)) {
                        $deletedCount++;
                        $bytesFreed += $size;
                    }
                }
            }
        }

        return [
            'deleted' => $deletedCount,
            'bytes' => $bytesFreed,
        ];
    }

    /**
     * Opportunistic auto-prune during web requests (throttled to at most once every 30 mins).
     */
    public static function autoPruneIfNeeded(int $intervalSeconds = 1800): void
    {
        $cacheDir = storage_path('framework/cache');
        if (! is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $lockFile = $cacheDir.'/last_cache_prune.time';
        $now = time();
        if (file_exists($lockFile)) {
            $lastRun = (int) @file_get_contents($lockFile);
            if (($now - $lastRun) < $intervalSeconds) {
                return;
            }
        }
        @file_put_contents($lockFile, (string) $now);

        try {
            self::pruneExpiredCache();
        } catch (\Throwable $e) {
            Log::warning('Auto-prune cache error: '.$e->getMessage());
        }
    }

    /**
     * Register a shutdown function to auto-prune cache in the background after the response is sent.
     */
    public static function scheduleShutdownPrune(): void
    {
        static $registered = false;
        if (! $registered) {
            $registered = true;
            register_shutdown_function(function () {
                self::autoPruneIfNeeded();
            });
        }
    }
}
