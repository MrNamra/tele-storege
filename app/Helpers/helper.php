<?php

use Illuminate\Support\Facades\Crypt;

if(!function_exists("encryptId")) {
    function encryptId($id)
    {
        // return Hashids::encode($id);
        return rtrim(strtr(base64_encode(Crypt::encryptString($id)), '+/', '-_'), '=');
    }
}
if(!function_exists("decryptId")) {
    function decryptId($id)
    {
        // return Hashids::decode($id);
        return Crypt::decryptString(base64_decode(strtr($id, '-_', '+/')));
    }
}
if(!function_exists("pickBestThumb")) {
    function pickBestThumb(array $thumbs)
    {
        // usort($thumbs, fn($a, $b) => ($b['w'] ?? 0) <=> ($a['w'] ?? 0));
        // return $thumbs[0];
        foreach ($thumbs as $t) {
            if (($t['_'] ?? '') === 'photoStrippedSize') {
                return $t;
            }
            if (($t['_'] ?? '') === 'photoSize' && ($t['type'] ?? '') === 'm') {
                return [$t];
            }
            if (($t['_'] ?? '') === 'photoSize') {
                return $t;
            }
        }

        return $thumbs[0];
    }
}
