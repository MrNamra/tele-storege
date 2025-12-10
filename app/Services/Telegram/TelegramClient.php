<?php

namespace App\Services\Telegram;

use danog\MadelineProto\API;
use Illuminate\Support\Facades\Log;

class TelegramClient
{
    protected API $MadelineProto;

    public function __construct()
    {
        $session = storage_path('telegram/session.madeline');

        // Initialize MadelineProto instance
        $this->MadelineProto = new API($session);

        $this->MadelineProto->start();
    }

    public function client(): API
    {
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
        // Upload file to Telegram
        $inputFile = $this->client()->upload($file->getRealPath(), $originalName);

        $mimeType = $file->getMimeType();

        if (str_starts_with($mimeType, 'image/')) {
            $media = [
                '_' => 'inputMediaUploadedPhoto',
                'file' => $inputFile,
            ];
        } else {
            $media = [
                '_' => 'inputMediaUploadedDocument',
                'file' => $inputFile,
                'mime_type' => $mimeType,
                'attributes' => [
                    ['_' => 'documentAttributeFilename', 'file_name' => $originalName]
                ]
            ];
        }


        return $this->client()->messages->sendMedia(
            peer: $channelId,
            media: $media
        );
    }
    public function getChannelFiles(string $channelId, string $accessHash = '0', int $page = 1, int $perPage = 5): array
    {
        // Calculate offset
        $offsetId = 0; // Telegram API uses message IDs, not zero-based offset
        $limit = $perPage;

        $totalResponse = $this->client()->messages->getHistory(
                            peer: $channelId,
                            // offset_id: 0,
                            // offset_date: 0,
                            // add_offset: 0,
                            limit: 1,
                            // max_id: 0,
                            // min_id: 0,
                            // hash: 0
                        );

        $totalCount = $totalResponse['count'] ?? 0;

        // Use messages.getHistory to fetch messages
        $history = $this->client()->messages->getHistory(
            // peer: $peer,
            peer: $channelId,
            // offset_id: 0,
            // offset_date: 0,
            add_offset: ($page - 1) * $perPage,
            limit: $limit,
        );

        $files = [];

        foreach ($history['messages'] as $msg) {
            if (!isset($msg['media'])) {
                continue;
            }
            $fileData = [
                        'id' => $msg['id'],
                        'date' => $msg['date'],
                        'type' => null,
                        'file_name' => null,
                        'mime_type' => null,
                        'size' => null,
                        'thumbnail' => null,
                        'stream_url' => ''//route('stream.file', ['id' => $msg['id']])
                    ];
            if (isset($msg['media']['photo'])) {
                $photo = $msg['media']['photo'];

                // Thumbnail exists: last size is largest -> use any size for thumbnail
                $sizes = $photo['sizes'];
                $thumb = $sizes[1] ?? $sizes[0] ?? null;

                $fileData['type'] = 'photo';
                $fileData['mime_type'] = 'image/jpeg';
                $fileData['size'] = null;
                $fileData['thumbnail'] = route('thumbnail', ['id' => $msg['id']]);
            }

            // ---------------- DOCUMENT (PDF, ZIP, VIDEO, AUDIO) ----------------
            if (isset($msg['media']['document'])) {
                $doc = $msg['media']['document'];

                $fileData['type'] = 'document';
                $fileData['size'] = $doc['size'] ?? null;
                $fileData['mime_type'] = $doc['mime_type'] ?? null;

                // Extract name
                foreach ($doc['attributes'] as $attr) {
                    if ($attr['_'] === 'documentAttributeFilename') {
                        $fileData['file_name'] = $attr['file_name'];
                    }
                }

                // Thumbnail inside thumbs array if exists
                if (isset($doc['thumbs'][0])) {
                    dd($doc['thumbs']);
                    $fileData['thumbnail'] = route('thumbnail', ['id' => $msg['id']]);
                }

                // Detect video
                foreach ($doc['attributes'] as $attr) {
                    if ($attr['_'] === 'documentAttributeVideo') {
                        $fileData['type'] = 'video';
                    }
                }

                // Audio
                foreach ($doc['attributes'] as $attr) {
                    if ($attr['_'] === 'documentAttributeAudio') {
                        $fileData['type'] = 'audio';
                    }
                }
            }

            $files[] = $fileData;
        }

        return [
            'data' => $files,
            'total' => $totalCount
        ];
    }
    public function streamThumbnailFromTelegram(string $channelId, int $messageId)
    {
        $response = $this->client()->messages->getHistory(
            peer: $channelId,
            offset_id: (int) $messageId,
            add_offset: -1,
            limit: 1
        );
        dd($response);

        if (empty($response['messages'][0])) {
            abort(404, "Message not found");
        }

        $msg = $response['messages'][0];

        if (!isset($msg['media']['document'])) {
            abort(404, "No document found");
        }

        $document = $msg['media']['document'];

        if (!isset($document['thumbs'][0])) {
            abort(404, "Thumbnail not available");
        }

        $thumb = $document['thumbs'][0];

        return response()->stream(function () use ($document, $thumb) {
            $this->client()->downloadToStream(
                [ 'document' => $document, 'thumb' => $thumb ],
                fopen("php://output", "wb")
            );
        }, 200, [
            "Content-Type" => "image/jpeg",
            "Content-Disposition" => "inline"
        ]);
    }

    public function streamThumbnail(int $messageId)
    {
        $history = $this->client()->messages->getHistory(
            // peer: $this->channelId,
            peer: "-1003431070811",
            offset_id: $messageId - 1,
            add_offset: 0,
            limit: 1
        );

        $msg = $history['messages'][0] ?? null;

        if (!$msg || !isset($msg['media'])) {
            abort(404, "Thumbnail not found");
        }

        // ------ PHOTO ------
        if (isset($msg['media']['photo'])) {
            $photo = $msg['media']['photo'];

            // Choose best thumbnail size (lowest resolution or stripped)
            $sizes = $photo['sizes'];
            $thumb = $sizes[1] ?? $sizes[0] ?? null;

            return $this->client()->downloadToStream(
                $thumb,
                fopen('php://output', 'wb')
            );
        }

        // ------ DOCUMENT THUMB -------
        if (isset($msg['media']['document']['thumbs'][0])) {
            $thumb = $msg['media']['document']['thumbs'][0];

            return $this->client()->downloadToStream(
                $thumb,
                fopen('php://output', 'wb')
            );
        }

        // ------ FALLBACK (GENERATE ICON IMAGE) ------
        return response()->file(public_path('fallback/file.jpg')); // Make your default thumbnail icon
    }
    public function streamFile(int $messageId)
    {
        $history = $this->client()->messages->getHistory(
            // peer: $this->channelId,
            peer: "-1003431070811",
            offset_id: $messageId - 1,
            limit: 1
        );

        $msg = $history['messages'][0] ?? null;

        if (!$msg || !isset($msg['media'])) {
            abort(404, "File not found");
        }

        $media = $msg['media'];

        // Photo full download
        if (isset($media['photo'])) {
            $photo = $media['photo'];
            $sizes = $photo['sizes'];
            $thumb = $sizes[1] ?? $sizes[0];
            return $this->client()->downloadToStream(
                $thumb,
                fopen('php://output', 'wb')
            );
        }

        // Document full streaming
        if (isset($media['document']['thumbs'][0])) {
            $thumb = $msg['media']['document']['thumbs'][0];
            return $this->client()->downloadToStream($thumb, fopen('php://output', 'wb'));
        }

        abort(404, "Unsupported media type");
    }
}
