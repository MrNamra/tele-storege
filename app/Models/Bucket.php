<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Bucket extends Model
{
    protected $fillable = [
        'user_id',
        'bucketName',
        'channel_id',
        'access_hash',
    ];

    protected $appends = ['code'];

    // protected $hidden = ['id'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function bucketShare()
    {
        return $this->hasOne(BucketShare::class, 'bucket_id', 'id');
    }

    public function getCodeAttribute()
    {
        return $this->bucketShare?->code;
    }

    // public function getPublicIdAttribute()
    // {
    //     return encryptId($this->id);
    // }
}
