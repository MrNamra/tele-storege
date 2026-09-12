<?php

use Illuminate\Support\Facades\Crypt;

if(!function_exists("encryptId")) {
    function encryptId($id)
    {
        return rtrim(strtr(base64_encode(Crypt::encryptString((string)$id)), '+/', '-_'), '=');
    }
}
if(!function_exists("decryptId")) {
    function decryptId($id)
    {
        return Crypt::decryptString(base64_decode(strtr($id, '-_', '+/')));
    }
}
if(!function_exists("safeEncryptId")) {
    function safeEncryptId($id)
    {
        return rtrim(strtr(encrypt((string)$id), '+/', '-_'), '=');
    }
}
if(!function_exists("safeDecryptId")) {
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
            } catch (\Throwable $e) {}

            try {
                $dec = Crypt::decryptString($cand);
                if (is_numeric($dec)) {
                    return (int) $dec;
                }
            } catch (\Throwable $e) {}

            try {
                $dec = decryptId($cand);
                if (is_numeric($dec)) {
                    return (int) $dec;
                }
            } catch (\Throwable $e) {}
        }

        return null;
    }
}
if(!function_exists("pickBestThumb")) {
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

if (!function_exists("convertHeicToJpeg")) {
    function convertHeicToJpeg(string $heicPath, string $targetJpgPath, float $quality = 0.85): bool
    {
        if (!file_exists($heicPath) || filesize($heicPath) === 0) {
            return false;
        }

        $script = base_path('storage/tools/convert-heic.js');
        if (!file_exists($script)) {
            return false;
        }

        $cmd = 'node ' . escapeshellarg($script) . ' ' . escapeshellarg($heicPath) . ' ' . escapeshellarg($targetJpgPath) . ' ' . escapeshellarg((string)$quality) . ' 2>&1';
        exec($cmd, $output, $code);

        return ($code === 0 && file_exists($targetJpgPath) && filesize($targetJpgPath) > 0);
    }
}

if(!function_exists("generateThumbnail")) {
    function generateThumbnail(string $sourcePath, string $targetPath, int $maxWidth = 300, int $maxHeight = 300, int $quality = 75): bool
    {
        if (!file_exists($sourcePath) || filesize($sourcePath) === 0) {
            return false;
        }

        $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));
        $tempConverted = null;

        if (in_array($ext, ['heic', 'heif'])) {
            $tempConverted = tempnam(sys_get_temp_dir(), 'heic_thumb_') . '.jpg';
            if (convertHeicToJpeg($sourcePath, $tempConverted, 0.85)) {
                $sourcePath = $tempConverted;
            } else {
                @unlink($tempConverted);
                return false;
            }
        }

        $info = @getimagesize($sourcePath);
        if (!$info) {
            if ($tempConverted) @unlink($tempConverted);
            return false;
        }

        [$origWidth, $origHeight, $imageType] = $info;
        if ($origWidth <= 0 || $origHeight <= 0) {
            return false;
        }

        $sourceImage = match ($imageType) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($sourcePath),
            IMAGETYPE_PNG  => @imagecreatefrompng($sourcePath),
            IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($sourcePath) : false,
            IMAGETYPE_GIF  => @imagecreatefromgif($sourcePath),
            IMAGETYPE_BMP  => function_exists('imagecreatefrombmp') ? @imagecreatefrombmp($sourcePath) : false,
            default        => false,
        };

        if (!$sourceImage) {
            return false;
        }

        // Fix EXIF orientation for smartphone photos (iOS / Android)
        if ($imageType === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
            $exif = @exif_read_data($sourcePath);
            if (!empty($exif['Orientation'])) {
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
        if (!is_dir($dir)) {
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
