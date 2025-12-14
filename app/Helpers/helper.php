<?php

use Vinkla\Hashids\Facades\Hashids;

if(!function_exists("encryptId")) {
    function encryptId($id)
    {
        return Hashids::encode($id);
    }
}
if(!function_exists("decryptId")) {
    function decryptId($id)
    {
        return Hashids::decode($id);
    }
}
