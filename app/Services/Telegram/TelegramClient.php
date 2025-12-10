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
    public function getChannelFiles(string $channelId, int $page = 1, int $perPage = 20)
    {
        $history = $this->client()->messages->getHistory(
            peer: $channelId,
            add_offset: ($page - 1) * $perPage,
            limit: $perPage
        );

        $files = [];

        foreach ($history['messages'] as $msg) {
            if (!isset($msg['media'])) continue;

            $media = $msg['media'];

            $file = [
                'msg_id'     => $msg['id'],
                'date'       => $msg['date'],
                'type'       => null,
                'file_name'  => null,
                'mime_type'  => null,
                'size'       => null,
                // 'thumbnail'  => route('thumbnail', ['channel' => $channelId, 'id' => $msg['id']]),
                'thumbnail'  => route('thumbnail', $msg['id']),
                // 'download'   => route('tg.stream', ['channel' => $channelId, 'id' => $msg['id']]),
            ];

            /** PHOTO */
            if (isset($media['photo'])) {
                $file['type'] = 'photo';
                $file['mime_type'] = 'image/jpeg';
                $files[] = $file;
                continue;
            }

            /** DOCUMENT (PDF, VIDEO, ZIP, AUDIO, PNG, etc.) */
            if (isset($media['document'])) {
                $doc = $media['document'];

                $file['type'] = 'document';
                $file['mime_type'] = $doc['mime_type'] ?? null;
                $file['size'] = $doc['size'] ?? null;

                foreach ($doc['attributes'] as $attr) {
                    if ($attr['_'] === 'documentAttributeFilename') {
                        $file['file_name'] = $attr['file_name'];
                    }
                    if ($attr['_'] === 'documentAttributeVideo') $file['type'] = 'video';
                    if ($attr['_'] === 'documentAttributeAudio') $file['type'] = 'audio';
                }

                $files[] = $file;
            }
        }

        return ['data' => $files];
    }

    public function streamThumbnailFromTelegram(string $channelId, int $messageId)
    {
        $response = $this->client()->messages->getHistory(
            peer: $channelId,
            offset_id: (int) $messageId,
            add_offset: -1,
            limit: 1
        );

        if (empty($response['messages'][0])) {
            abort(404, "Message not found");
        }

        $msg = $response['messages'][0];

        if (!isset($msg['media']['photo'])) {
            abort(404, "No photo found");
        }

        $photo = $msg['media']['photo'];
        $sizes = $photo['sizes'];

        if ($sizes[0]['_'] !== 'photoStrippedSize') {
            abort(404, "No photo found");
        }

        

    }

    public function streamThumbnail(int $msgId)
    {
        $history = $this->client()->messages->getHistory(
            // peer: $channelId,
            peer: -1003431070811,
            offset_id: $msgId,
            add_offset: -1,
            limit: 1
        );

        $msg = $history['messages'][0] ?? null;
        if (!$msg || !isset($msg['media'])) abort(404);

        $media = $msg['media'];

        if (isset($media['photo'])) {
            $photo = $media['photo'];
            $sizes = $photo['sizes'];

            if ($sizes[0]['_'] === 'photoStrippedSize') {

                // $jpegBytes = (string) $sizes[0]['inflated'];
                $thumb = $sizes[1];

                // return response($jpegBytes, 200, [
                //     "Content-Type" => "image/jpeg"
                // ]);
                // $thumbLocation = $this->client()->getDownloadInfo($sizes[1]);
                // $stream = fopen('php://output', 'wb');
                // dd($this->client()->downloadToStream($thumbLocation, $stream));
                return response()->stream(function () use ($photo) {
                    $stream = fopen('php://output', 'wb');
                    $this->client()->downloadToStream($photo, $stream);
                }, 200, [
                    "Content-Type" => "image/jpeg"
                ]);
            }

            // Otherwise: a downloadable thumbnail exists
            $thumb = $sizes[1];

            return response()->stream(function () use ($thumb) {
                $this->client()->downloadToStream($thumb, fopen('php://output', 'wb'));
            }, 200, ["Content-Type" => "image/jpeg"]);
        }

        if (isset($media['document']['thumbs'][0])) {
            $thumb = [
                'document' => $media['document'],
                'thumb' => $media['document']['thumbs'][0]
            ];

            return response()->stream(function () use ($thumb) {
                $this->client()->downloadToStream($thumb, fopen('php://output', 'wb'));
            }, 200, ["Content-Type" => "image/jpeg"]);
        }

        return response()->file(public_path('fallback/file.jpg'));
    }
    public function streamFile(string $channelId, int $msgId)
    {
        $history = $this->client()->messages->getHistory(
            // peer: $channelId,
            peer: -1003431070811,
            offset_id: $msgId,
            add_offset: -1,
            limit: 1
        );

        $msg = $history['messages'][0] ?? null;
        if (!$msg || !isset($msg['media'])) abort(404);

        $media = $msg['media'];

        return response()->stream(function () use ($media) {
            $this->client()->downloadToStream($media, fopen('php://output', 'wb'));
        }, 200, [
            "Content-Type" => $media['document']['mime_type'] ?? "application/octet-stream"
        ]);
    }
}
