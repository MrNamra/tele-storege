<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Bucket extends Model
{
    protected $fillable = [
        "user_id",
        "bucketName"
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
