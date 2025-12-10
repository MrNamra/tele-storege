<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('buckets', function (Blueprint $table) {
            $table->string('channel_id')->nullable()->after('user_id');
            $table->string('access_hash')->nullable()->after('bucketName');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('buckets', function (Blueprint $table) {
            $table->dropColumn('channel_id');
            $table->dropColumn('access_hash');
        });
    }
};
