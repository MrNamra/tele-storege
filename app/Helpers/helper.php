<?php

use danog\MadelineProto\Tools;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;

if (! function_exists('encryptId')) {
    function encryptId($id)
    {
        return rtrim(strtr(base64_encode(Crypt::encryptString((string) $id)), '+/', '-_'), '=');
    }
}
if (! function_exists('decryptId')) {
    function decryptId($id)
    {
        return Crypt::decryptString(base64_decode(strtr($id, '-_', '+/')));
    }
}
if (! function_exists('safeEncryptId')) {
    function safeEncryptId($id)
    {
        return rtrim(strtr(encrypt((string) $id), '+/', '-_'), '=');
    }
}
if (! function_exists('safeDecryptId')) {
    function safeDecryptId($id)
    {
        if (empty($id)) {
            return null;
        }
        if (is_numeric($id)) {
            return (int) $id;
        }

        $candidates = [
            $id,
            strtr($id, '-_', '+/'),
        ];

        foreach ($candidates as $cand) {
            try {
                $dec = decrypt($cand);
                if (is_numeric($dec)) {
                    return (int) $dec;
                }
            } catch (Throwable $e) {
            }

            try {
                $dec = Crypt::decryptString($cand);
                if (is_numeric($dec)) {
                    return (int) $dec;
                }
            } catch (Throwable $e) {
            }

            try {
                $dec = decryptId($cand);
                if (is_numeric($dec)) {
                    return (int) $dec;
                }
            } catch (Throwable $e) {
            }
        }

        return null;
    }
}
if (! function_exists('pickBestThumb')) {
    function pickBestThumb(?array $thumbs)
    {
        if (empty($thumbs)) {
            return null;
        }

        // 1. Prefer medium size 'm' (~320px) - ideal thumbnail size
        foreach ($thumbs as $t) {
            if (($t['_'] ?? '') === 'photoSize' && ($t['type'] ?? '') === 'm') {
                return $t;
            }
        }

        // 2. Small size 's' (~100px)
        foreach ($thumbs as $t) {
            if (($t['_'] ?? '') === 'photoSize' && ($t['type'] ?? '') === 's') {
                return $t;
            }
        }

        // 3. Any standard photoSize
        foreach ($thumbs as $t) {
            if (($t['_'] ?? '') === 'photoSize') {
                return $t;
            }
        }

        // 4. Any thumb that is not stripped bytes
        foreach ($thumbs as $t) {
            if (($t['_'] ?? '') !== 'photoStrippedSize') {
                return $t;
            }
        }

        return $thumbs[0];
    }
}

if (! function_exists('extractStrippedJpeg')) {
    function extractStrippedJpeg(?array $sizesOrThumbs): ?string
    {
        if (empty($sizesOrThumbs)) {
            return null;
        }

        foreach ($sizesOrThumbs as $item) {
            if (($item['_'] ?? '') === 'photoStrippedSize' || ($item['type'] ?? '') === 'photoStrippedSize' || ($item['type'] ?? '') === 'i') {
                if (isset($item['inflated'])) {
                    $inflated = $item['inflated'];
                    if (is_object($inflated) && isset($inflated->bytes)) {
                        return (string) $inflated->bytes;
                    }
                    if (is_array($inflated) && isset($inflated['bytes'])) {
                        return (string) $inflated['bytes'];
                    }
                    if (is_string($inflated)) {
                        return $inflated;
                    }
                }

                $raw = $item['bytes']['bytes'] ?? $item['bytes'] ?? null;
                if (! empty($raw) && is_string($raw)) {
                    if (class_exists('\danog\MadelineProto\Tools')) {
                        try {
                            return Tools::inflateStripped($raw);
                        } catch (Throwable $e) {
                        }
                    }
                    if (strlen($raw) >= 3 && ord($raw[0]) === 1) {
                        $header = "\xff\xd8\xff\xe0\x00\x10\x4a\x46\x49\x46\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00\x43\x00\x28\x1c\x1e\x23\x1e\x19\x28\x23\x21\x23\x2d\x2b\x28\x30\x3c\x64\x41\x3c\x37\x37\x3c\x7b\x58\x5d\x49\x64\x91\x80\x99\x96\x8f\x80\x8c\x8a\xa0\xb4\xe6\xc3\xa0\xaa\xda\xad\x8a\x8c\xc8\xff\xcb\xda\xee\xf5\xff\xff\xff\x9b\xc1\xff\xff\xff\xfa\xff\xe6\xfd\xff\xf8\xff\xdb\x00\x43\x01\x2b\x2d\x2d\x3c\x35\x3c\x76\x41\x41\x76\xf8\xa5\x8c\xa5\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xf8\xff\xc0\x00\x11\x08\x00\x00\x00\x00\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01\x7d\x01\x02\x03\x00\x04\x11\x05\x12\x21\x31\x41\x06\x13\x51\x61\x07\x22\x71\x14\x32\x81\x91\xa1\x08\x23\x42\xb1\xc1\x15\x52\xd1\xf0\x24\x33\x62\x72\x82\x09\x0a\x16\x17\x18\x19\x1a\x25\x26\x27\x28\x29\x2a\x34\x35\x36\x37\x38\x39\x3a\x43\x44\x45\x46\x47\x48\x49\x4a\x53\x54\x55\x56\x57\x58\x59\x5a\x63\x64\x65\x66\x67\x68\x69\x6a\x73\x74\x75\x76\x77\x78\x79\x7a\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xc4\x00\x1f\x01\x00\x03\x01\x01\x01\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\xff\xc4\x00\xb5\x11\x00\x02\x01\x02\x04\x04\x03\x04\x07\x05\x04\x04\x00\x01\x02\x77\x00\x01\x02\x03\x11\x04\x05\x21\x31\x06\x12\x41\x51\x07\x61\x71\x13\x22\x32\x81\x08\x14\x42\x91\xa1\xb1\xc1\x09\x23\x33\x52\xf0\x15\x62\x72\xd1\x0a\x16\x24\x34\xe1\x25\xf1\x17\x18\x19\x1a\x26\x27\x28\x29\x2a\x35\x36\x37\x38\x39\x3a\x43\x44\x45\x46\x47\x48\x49\x4a\x53\x54\x55\x56\x57\x58\x59\x5a\x63\x64\x65\x66\x67\x68\x69\x6a\x73\x74\x75\x76\x77\x78\x79\x7a\x82\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda\x00\x0c\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00";
                        $header[164] = $raw[1];
                        $header[166] = $raw[2];

                        return $header.substr($raw, 3)."\xff\xd9";
                    }
                }
            }
        }

        return null;
    }
}

if (! function_exists('convertHeicToJpeg')) {
    function convertHeicToJpeg(string $heicPath, string $targetJpgPath, float $quality = 0.85): bool
    {
        if (! file_exists($heicPath) || filesize($heicPath) === 0) {
            return false;
        }

        $script = base_path('storage/tools/convert-heic.js');
        if (! file_exists($script)) {
            return false;
        }

        $cmd = 'node '.escapeshellarg($script).' '.escapeshellarg($heicPath).' '.escapeshellarg($targetJpgPath).' '.escapeshellarg((string) $quality).' 2>&1';
        exec($cmd, $output, $code);

        return $code === 0 && file_exists($targetJpgPath) && filesize($targetJpgPath) > 0;
    }
}

if (! function_exists('getFfmpegPath')) {
    function getFfmpegPath(): ?string
    {
        $bundled = base_path('storage/tools/node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
        if (file_exists($bundled) && is_executable($bundled)) {
            return $bundled;
        }

        $system = trim((string) @shell_exec('which ffmpeg 2>/dev/null'));
        if (! empty($system) && file_exists($system) && is_executable($system)) {
            return $system;
        }

        try {
            $nodeCheck = trim((string) @shell_exec('node -e "try { console.log(require(\'@ffmpeg-installer/ffmpeg\').path); } catch(e){}" 2>/dev/null'));
            if (! empty($nodeCheck) && file_exists($nodeCheck) && is_executable($nodeCheck)) {
                return $nodeCheck;
            }
        } catch (Throwable $e) {
        }

        return null;
    }
}

if (! function_exists('convertVideoToMp4')) {
    function convertVideoToMp4(string $sourcePath, string $targetMp4Path): bool
    {
        if (! file_exists($sourcePath) || filesize($sourcePath) === 0) {
            return false;
        }

        $targetDir = dirname($targetMp4Path);
        if (! is_dir($targetDir)) {
            @mkdir($targetDir, 0775, true);
        }

        // Method 1: Use node converter script if available
        $script = base_path('storage/tools/convert-video.js');
        if (file_exists($script)) {
            $cmd = 'node '.escapeshellarg($script).' '.escapeshellarg($sourcePath).' '.escapeshellarg($targetMp4Path).' 2>&1';
            exec($cmd, $nodeOut, $nodeCode);
            if ($nodeCode === 0 && file_exists($targetMp4Path) && filesize($targetMp4Path) > 0) {
                return true;
            }
        }

        // Method 2: Direct ffmpeg binary execution
        $ffmpeg = getFfmpegPath();
        if (! $ffmpeg) {
            Log::warning('convertVideoToMp4: ffmpeg binary not found');

            return false;
        }

        $tempTarget = "{$targetMp4Path}.tmp.".uniqid().'.mp4';

        // Probe codec to see if fast copy can be used
        $probeCmd = escapeshellcmd($ffmpeg).' -i '.escapeshellarg($sourcePath).' 2>&1';
        $probeOutput = (string) @shell_exec($probeCmd);

        $isHevc = (stripos($probeOutput, 'hevc') !== false || stripos($probeOutput, 'h265') !== false);
        $isH264 = (stripos($probeOutput, 'h264') !== false || stripos($probeOutput, 'avc1') !== false);

        if ($isH264 && ! $isHevc) {
            $cmdFast = escapeshellcmd($ffmpeg).' -y -i '.escapeshellarg($sourcePath)
                .' -c:v copy -c:a aac -b:a 128k -movflags +faststart '
                .escapeshellarg($tempTarget).' 2>&1';
            exec($cmdFast, $outFast, $codeFast);

            if ($codeFast === 0 && file_exists($tempTarget) && filesize($tempTarget) > 0) {
                @rename($tempTarget, $targetMp4Path);

                return true;
            }
            if (file_exists($tempTarget)) {
                @unlink($tempTarget);
            }
        }

        // Universal H.264 transcode with ultrafast preset and faststart
        $cmdTranscode = escapeshellcmd($ffmpeg).' -y -i '.escapeshellarg($sourcePath)
            .' -c:v libx264 -preset ultrafast -tune fastdecode -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart '
            .escapeshellarg($tempTarget).' 2>&1';

        exec($cmdTranscode, $outTranscode, $codeTranscode);

        if ($codeTranscode === 0 && file_exists($tempTarget) && filesize($tempTarget) > 0) {
            @rename($tempTarget, $targetMp4Path);

            return true;
        }

        if (file_exists($tempTarget)) {
            @unlink($tempTarget);
        }

        Log::warning('convertVideoToMp4 direct ffmpeg failed: '.implode("\n", array_slice($outTranscode ?? [], -5)));

        return false;
    }
}

if (! function_exists('generateThumbnail')) {
    function generateThumbnail(string $sourcePath, string $targetPath, int $maxWidth = 300, int $maxHeight = 300, int $quality = 75): bool
    {
        if (! file_exists($sourcePath) || filesize($sourcePath) === 0) {
            return false;
        }

        $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));
        $tempConverted = null;

        if (in_array($ext, ['heic', 'heif'])) {
            $tempConverted = tempnam(sys_get_temp_dir(), 'heic_thumb_').'.jpg';
            if (convertHeicToJpeg($sourcePath, $tempConverted, 0.85)) {
                $sourcePath = $tempConverted;
            } else {
                @unlink($tempConverted);

                return false;
            }
        }

        $info = @getimagesize($sourcePath);
        if (! $info) {
            if ($tempConverted) {
                @unlink($tempConverted);
            }

            return false;
        }

        [$origWidth, $origHeight, $imageType] = $info;
        if ($origWidth <= 0 || $origHeight <= 0) {
            return false;
        }

        // Memory protection for massive DSLR images (e.g. 24-50 megapixels)
        $totalPixels = $origWidth * $origHeight;
        if ($totalPixels > 60000000) {
            if ($tempConverted) {
                @unlink($tempConverted);
            }

            return false;
        }
        if ($totalPixels > 6000000) {
            @ini_set('memory_limit', '512M');
        }

        $sourceImage = match ($imageType) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($sourcePath),
            IMAGETYPE_PNG => @imagecreatefrompng($sourcePath),
            IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($sourcePath) : false,
            IMAGETYPE_GIF => @imagecreatefromgif($sourcePath),
            IMAGETYPE_BMP => function_exists('imagecreatefrombmp') ? @imagecreatefrombmp($sourcePath) : false,
            default => false,
        };

        if (! $sourceImage) {
            return false;
        }

        // Fix EXIF orientation for smartphone photos (iOS / Android)
        if ($imageType === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
            $exif = @exif_read_data($sourcePath);
            if (! empty($exif['Orientation'])) {
                $sourceImage = match ($exif['Orientation']) {
                    3 => imagerotate($sourceImage, 180, 0),
                    6 => imagerotate($sourceImage, -90, 0),
                    8 => imagerotate($sourceImage, 90, 0),
                    default => $sourceImage,
                };
                $origWidth = imagesx($sourceImage);
                $origHeight = imagesy($sourceImage);
            }
        }

        $ratio = min($maxWidth / $origWidth, $maxHeight / $origHeight);
        $newWidth = max(1, (int) round($origWidth * min(1.0, $ratio)));
        $newHeight = max(1, (int) round($origHeight * min(1.0, $ratio)));

        $thumbImage = imagecreatetruecolor($newWidth, $newHeight);

        // Fill background white for transparent PNGs/GIFs
        $white = imagecolorallocate($thumbImage, 255, 255, 255);
        imagefilledrectangle($thumbImage, 0, 0, $newWidth, $newHeight, $white);

        imagecopyresampled($thumbImage, $sourceImage, 0, 0, 0, 0, $newWidth, $newHeight, $origWidth, $origHeight);

        $dir = dirname($targetPath);
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $result = imagejpeg($thumbImage, $targetPath, $quality);

        imagedestroy($sourceImage);
        imagedestroy($thumbImage);

        if ($tempConverted) {
            @unlink($tempConverted);
        }

        return $result;
    }
}
