<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Bucket extends Model
{
    protected $fillable = [
        "user_id",
        "bucketName",
        "channel_id",
        "access_hash"
    ];

    protected $appends = ['enc_id'];

    protected $hidden = ['id'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function getEncIdAttribute()
    {
        return encryptId($this->id);
    }

    public function getPublicIdAttribute()
    {
        return encryptId($this->id);
    }
}
