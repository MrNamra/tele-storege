<?php

namespace App\Services\Telegram;

use danog\MadelineProto\API;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\URL;

class TelegramClient
{
    protected API $MadelineProto;
    protected bool $started = false;

    public function __construct()
    {
        $session = storage_path('telegram/session.madeline');
        $sessionDir = dirname($session);
        if (!is_dir($sessionDir)) {
            @mkdir($sessionDir, 0775, true);
        }

        $settings = new \danog\MadelineProto\Settings;
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
        if (!$this->started) {
            $this->started = true;
            if ($this->isLoggedIn()) {
                try {
                    $this->MadelineProto->start();
                } catch (\Throwable $e) {
                    Log::warning("MadelineProto start: " . $e->getMessage());
                }
            }
        }
    }

    public function client(): API
    {
        $this->ensureStarted();
        if (!$this->isLoggedIn()) {
            throw new \Exception("Telegram session is not logged in. Please run 'php artisan telegram:login' in your terminal to connect your Telegram account.");
        }
        return $this->MadelineProto;
    }
    public function createPrivateChannel(string $name): array
    {
        $result = Self::client()->channels->createChannel(
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
            'channel_id'  => $channel['id'],
            'access_hash' => $accessHash
        ];
    }
    public function updateChannelName(string $channelId, string $newName): bool
    {
        // Get full info first
        $fullInfo = $this->client()->getFullInfo($channelId);

        if (!isset($fullInfo['Chat'])) {
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

        if (str_starts_with($mime, 'image/') && in_array($extension, ['jpg','jpeg'])) {
            $media = [
                '_' => 'inputMediaUploadedPhoto',
                'file' => $file,
            ];
        } else {
            // Document for PNG, WEBP, HEIC, PDF, ZIP, VIDEO, AUDIO etc
            $type = 'inputMediaUploadedDocument';

            $attributes = [
                ['_' => 'documentAttributeFilename', 'file_name' => $originalName]
            ];

            // Video attributes
            if (str_starts_with($mime, 'video/')) {
            $attributes[] = [
                '_' => 'documentAttributeVideo',
                'supports_streaming' => true
            ];
            }

            if (str_starts_with($mime, 'audio/')) {
                $attributes[] = [
                    '_' => 'documentAttributeAudio',
                    'voice' => false
                ];
            }

            $media = [
                '_' => $type,
                'file' => $file,
                'mime_type' => $mime,
                'attributes' => $attributes
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
    public function uploadFileToChannel(string $channelId, $file, string $originalName)
    {
        $mimeType = $file->getMimeType() ?? 'application/octet-stream';
        $realPath = $file->getRealPath();

        // 1. Upload main file to Telegram
        $inputFile = $this->client()->upload($realPath, $originalName);

        $attributes = [
            [
                '_' => 'documentAttributeFilename',
                'file_name' => $originalName
            ]
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
                    'h' => $h
                ];
            }

            // Generate a lightweight, high-quality compressed thumbnail (~15-25 KB)
            $tempThumb = tempnam(sys_get_temp_dir(), 'tg_thumb_') . '.jpg';
            if (generateThumbnail($realPath, $tempThumb, 320, 320, 75)) {
                try {
                    $mediaPayload['thumb'] = $this->client()->upload($tempThumb, 'thumb.jpg');
                } catch (\Throwable $e) {
                    Log::warning("Thumbnail upload to Telegram failed: " . $e->getMessage());
                }
            }
        } elseif (str_starts_with($mimeType, 'video/')) {
            $attributes[] = [
                '_' => 'documentAttributeVideo',
                'supports_streaming' => true,
            ];
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

        // Cache generated thumbnail locally for instant serving
        if ($isImage && $tempThumb && file_exists($tempThumb)) {
            $msgId = null;
            if (!empty($response['updates'])) {
                foreach ($response['updates'] as $up) {
                    if (isset($up['message']['id'])) {
                        $msgId = $up['message']['id'];
                        break;
                    }
                    if (isset($up['id'])) {
                        $msgId = $up['id'];
                        break;
                    }
                }
            }
            if (!$msgId && isset($response['id'])) {
                $msgId = $response['id'];
            }

            if ($msgId) {
                $cleanChannelId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$channelId);
                $cacheDir = storage_path('app/thumbnails');
                if (!is_dir($cacheDir)) {
                    @mkdir($cacheDir, 0775, true);
                }
                copy($tempThumb, "{$cacheDir}/thumb_{$cleanChannelId}_{$msgId}.jpg");
            }
            @unlink($tempThumb);
        }

        return $response;
    }
    public function getChannelFiles(string $channelId, string $bucket_id, int $page = 1, int $perPage = 20)
    {
        $history = null;
        try {
            $history = $this->client()->messages->getHistory(
                peer: $channelId,
                add_offset: ($page - 1) * $perPage,
                limit: $perPage
            );
        } catch (\Throwable $e) {
            Log::warning("getChannelFiles getHistory failed for channel {$channelId}: " . $e->getMessage());
            return [];
        }

        if (!$history || empty($history['messages'])) {
            return [];
        }

        $files = [];
        $isShared = \App\Models\BucketShare::where('bucket_id', $bucket_id)->exists();
        $token = request()->bearerToken() ?? request()->query('token');
        $tokenParam = (!$isShared && $token) ? ('?token=' . urlencode($token)) : '';

        $cleanChannelId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$channelId);
        $thumbDir = storage_path('app/thumbnails');
        if (!is_dir($thumbDir)) {
            @mkdir($thumbDir, 0775, true);
        }

        foreach ($history['messages'] as $msg) {
            if (!isset($msg['media'])) continue;

            $media = $msg['media'];
            $encId = safeEncryptId($msg['id']);

            // Pre-inflate stripped thumbnail on-the-fly (<0.1ms, zero network calls, zero RAM)
            $preCachePath = "{$thumbDir}/thumb_{$cleanChannelId}_{$msg['id']}.jpg";
            if (!file_exists($preCachePath) || filesize($preCachePath) === 0) {
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
                'msg_id'     => $encId,
                'date'       => $msg['date'],
                'type'       => null,
                'file_name'  => null,
                'mime_type'  => null,
                'size'       => null,
                'thumbnail'  => url("/api/thumbnail/{$bucket_id}/{$encId}") . $tokenParam,
                'stream_url' => url("/api/stream/{$bucket_id}/{$encId}") . $tokenParam,
            ];

            /** PHOTO */
            if (isset($media['photo'])) {
                $file['type'] = 'photo';
                $file['mime_type'] = 'image/jpeg';
                $file['file_name'] = 'photo_' . $msg['id'] . '.jpg';
                if (!empty($media['photo']['sizes'])) {
                    $largest = end($media['photo']['sizes']);
                    $file['size'] = $largest['size'] ?? null;
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

                if (!empty($doc['attributes'])) {
                    foreach ($doc['attributes'] as $attr) {
                        if ($attr['_'] === 'documentAttributeFilename') {
                            $file['file_name'] = $attr['file_name'];
                        }
                        if ($attr['_'] === 'documentAttributeVideo') $file['type'] = 'video';
                        if ($attr['_'] === 'documentAttributeAudio') $file['type'] = 'audio';
                    }
                }

                if (empty($file['file_name'])) {
                    $file['file_name'] = 'file_' . $msg['id'];
                }

                $files[] = $file;
            }
        }

        return $files;
    }
    public function getFileMeta(int|string $channelId, int $msgId): array
    {
        $result = $this->client()->messages->getHistory(
            peer: $channelId,
            offset_id: $msgId + 1,
            limit: 1
        );

        $message = $result['messages'][0] ?? null;

        if (!$message || empty($message['media'])) {
            throw new \Exception('No media found');
        }

        $media = $message['media'];

        if (isset($media['photo'])) {
            return [
                'mime'     => 'image/jpeg',
                'filename' => 'image.jpg',
                'media'    => $media,
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
                'mime'     => $media['document']['mime_type'] ?? 'application/octet-stream',
                'filename' => $filename,
                'media'    => $media,
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
  <rect x="40" y="36" width="80" height="38" rx="8" fill="' . $color . '" opacity="0.12"/>
  <text x="80" y="60" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="' . $color . '" text-anchor="middle" letter-spacing="1">' . $label . '</text>
  <circle cx="80" y="104" r="16" fill="' . $color . '"/>
  <path d="M75 96 L89 104 L75 112 Z" fill="white"/>
</svg>';

        return response($svg, 200, [
            'Content-Type'  => 'image/svg+xml',
            'Cache-Control' => 'public, max-age=604800, immutable',
        ]);
    }

    public function streamThumbnail(int|string $channelId, int $msgId)
    {
        $cleanChannelId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$channelId);
        $cacheDir = storage_path('app/thumbnails');
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0775, true);
        }
        $cachePath = "{$cacheDir}/thumb_{$cleanChannelId}_{$msgId}.jpg";

        // 1. Tier 1: Instant Disk Cache (<1ms, ~20KB)
        if (file_exists($cachePath) && filesize($cachePath) > 0) {
            return response()->file($cachePath, [
                'Content-Type'  => 'image/jpeg',
                'Cache-Control' => 'public, max-age=604800, immutable',
                'ETag'          => md5_file($cachePath),
            ]);
        }

        // 2. Fetch message from Telegram
        $msg = null;
        try {
            $history = $this->client()->messages->getHistory(
                peer: $channelId,
                offset_id: $msgId + 1,
                limit: 1
            );
            $msg = $history['messages'][0] ?? null;
        } catch (\Throwable $e) {
            Log::warning("streamThumbnail getHistory failed for channel {$channelId}, msg {$msgId}: " . $e->getMessage());
        }

        if (!$msg || empty($msg['media'])) {
            try {
                $res = $this->client()->messages->getMessages([
                    'peer' => $channelId,
                    'id'   => [$msgId],
                ]);
                $msg = $res['messages'][0] ?? null;
            } catch (\Throwable $e) {}
        }

        if (!$msg || empty($msg['media'])) {
            return $this->serveFallbackThumbnail();
        }

        $media = $msg['media'];

        // 3. Tier 2: Check for stripped thumbnail (<0.1ms, zero network calls, zero extra RAM)
        $strippedJpeg = null;
        if (isset($media['photo']['sizes'])) {
            $strippedJpeg = extractStrippedJpeg($media['photo']['sizes']);
        } elseif (isset($media['document']['thumbs'])) {
            $strippedJpeg = extractStrippedJpeg($media['document']['thumbs']);
        }
        if ($strippedJpeg) {
            @file_put_contents($cachePath, $strippedJpeg);
            if (file_exists($cachePath) && filesize($cachePath) > 0) {
                return response()->file($cachePath, [
                    'Content-Type'  => 'image/jpeg',
                    'Cache-Control' => 'public, max-age=604800, immutable',
                    'ETag'          => md5_file($cachePath),
                ]);
            }
        }

        // Case A: Photo with photoSize (downloads only ~15-30KB pre-generated thumb from Telegram)
        if (isset($media['photo'])) {
            $photo = $media['photo'];
            $sizes = $photo['sizes'] ?? [];
            $thumb = pickBestThumb($sizes);

            if ($thumb && ($thumb['_'] ?? '') === 'photoSize') {
                $tempFile = tempnam(sys_get_temp_dir(), 'tg_thumb_');
                $tempStream = fopen($tempFile, 'wb');
                try {
                    $photoToDownload = $photo;
                    $photoToDownload['sizes'] = [$thumb];
                    $this->client()->downloadToStream($photoToDownload, $tempStream);
                    fclose($tempStream);

                    // Telegram already provided a ~320px JPEG. Save directly without heavy GD resampling!
                    if (file_exists($tempFile) && filesize($tempFile) > 0) {
                        @rename($tempFile, $cachePath);
                    }
                } catch (\Throwable $e) {
                    Log::error("Failed to download photoSize thumb: " . $e->getMessage());
                } finally {
                    @unlink($tempFile);
                }

                if (file_exists($cachePath) && filesize($cachePath) > 0) {
                    return response()->file($cachePath, [
                        'Content-Type'  => 'image/jpeg',
                        'Cache-Control' => 'public, max-age=604800, immutable',
                        'ETag'          => md5_file($cachePath),
                    ]);
                }
            }
        }

        // Case B: Document with thumbs (downloads only ~15-30KB pre-generated thumb)
        if (!empty($media['document']['thumbs'])) {
            $doc   = $media['document'];
            $thumb = pickBestThumb($doc['thumbs']);

            if ($thumb && ($thumb['_'] ?? '') === 'photoSize') {
                $tempFile = tempnam(sys_get_temp_dir(), 'tg_doc_thumb_');
                $tempStream = fopen($tempFile, 'wb');
                try {
                    $downloadPayload = [
                        'InputFileLocation' => [
                            '_'              => 'inputDocumentFileLocation',
                            'id'             => $doc['id'],
                            'access_hash'    => $doc['access_hash'],
                            'file_reference' => $doc['file_reference'],
                            'thumb_size'     => $thumb['type'] ?? 'm',
                            'dc_id'          => $doc['dc_id'],
                        ],
                        'size' => $thumb['size'] ?? 30000,
                        'mime' => 'image/jpeg',
                        'ext'  => '.jpg',
                        'name' => 'thumb_' . $msgId,
                    ];

                    $this->client()->downloadToStream($downloadPayload, $tempStream);
                    fclose($tempStream);

                    if (file_exists($tempFile) && filesize($tempFile) > 0) {
                        @rename($tempFile, $cachePath);
                    }
                } catch (\Throwable $e) {
                    Log::error("Failed to download doc thumb: " . $e->getMessage());
                } finally {
                    @unlink($tempFile);
                }

                if (file_exists($cachePath) && filesize($cachePath) > 0) {
                    return response()->file($cachePath, [
                        'Content-Type'  => 'image/jpeg',
                        'Cache-Control' => 'public, max-age=604800, immutable',
                        'ETag'          => md5_file($cachePath),
                    ]);
                }
            }
        }

        // Case C: HEIC cache check
        $mime = $media['document']['mime_type'] ?? '';
        $heicCache = storage_path("app/heic_cache/heic_{$cleanChannelId}_{$msgId}.jpg");
        if (file_exists($heicCache) && filesize($heicCache) > 0) {
            generateThumbnail($heicCache, $cachePath, 320, 320, 75);
            if (file_exists($cachePath) && filesize($cachePath) > 0) {
                return response()->file($cachePath, [
                    'Content-Type'  => 'image/jpeg',
                    'Cache-Control' => 'public, max-age=604800, immutable',
                    'ETag'          => md5_file($cachePath),
                ]);
            }
        }

        // Case D: Never download full 20MB-50MB DSLR original files for thumbnails!
        // Instant SVG badge (<1KB, 0 RAM, 0 CPU, 0 network lag)
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
            Log::warning("streamFile getHistory failed: " . $e->getMessage());
        }

        if (!$message || empty($message['media'])) {
            $result = $this->client()->messages->getMessages([
                'peer' => $channelId,
                'id'   => [$msgId],
            ]);
            $message = $result['messages'][0] ?? null;
        }

        if (!$message || empty($message['media'])) {
            throw new \Exception('No media found');
        }

        $media = $message['media'];

        // Detect mime type
        if (isset($media['photo'])) {
            $mime = 'image/jpeg';
            $filename = 'photo_' . $msgId . '.jpg';
        } elseif (isset($media['document'])) {
            $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
            $filename = 'file_' . $msgId;
            foreach ($media['document']['attributes'] ?? [] as $attr) {
                if ($attr['_'] === 'documentAttributeFilename') {
                    $filename = $attr['file_name'];
                    break;
                }
            }
        } else {
            $mime = 'application/octet-stream';
            $filename = 'file_' . $msgId;
        }

        $this->client()->downloadToStream($media, $stream);

        return compact('mime', 'filename');
    }
    public function deleteFiles(int|string $channel_id, $IDs)
    {
        $IDs = array_map(fn($id) => safeDecryptId($id) ?? decrypt($id), $IDs);

        $this->client()->channels->deleteMessages(
            channel: $channel_id,
            id: $IDs
        );

        return true;
    }
    public function downlaodFiles($file, $channel_id)
    {
        $msgId = safeDecryptId($file) ?? (is_numeric($file) ? (int)$file : decrypt($file));
        $history = $this->client()->messages->getHistory(
            peer: $channel_id,
            offset_id: $msgId + 1,
            limit: 1
        );

        $message = $history['messages'][0] ?? null;

        if (!$message || empty($message['media'])) {
            abort(404, 'File not found');
        }

        $media = $message['media'];

        if (isset($media['photo'])) {
            $mime     = 'image/jpeg';
            $filename = 'photo_' . $msgId . '.jpg';
        } elseif (isset($media['document'])) {
            $mime = $media['document']['mime_type'] ?? 'application/octet-stream';
            $filename = 'file_' . $msgId;
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
            'Content-Type'        => $mime,
            'Content-Disposition' => 'attachment; filename="' . addcslashes($filename, '"') . '"; filename*=UTF-8\'\'' . rawurlencode($filename),
            'Accept-Ranges'       => 'bytes',
            'Cache-Control'       => 'no-store',
            'Access-Control-Allow-Origin' => '*',
            'Access-Control-Expose-Headers' => 'Content-Disposition, Content-Type, Content-Length',
        ]);
    }
}
