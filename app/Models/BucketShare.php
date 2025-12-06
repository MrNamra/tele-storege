<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BucketShare extends Model
{
    protected $fillable = [
        'bucket_id',
        'password',
        'code'
    ];

    public function bucket()
    {
        return $this->belongsTo(Bucket::class);
    }
}
