<?php

namespace App\Trait;

use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\JsonResponse;

trait ApiResponseTrait
{
    public function successResponse($data = [], $message = 'Opration success', $status = 200): JsonResponse
    {
        return response()->json(
            [
                'success' => true,
                'data' => $data,
                'message' => $message,
            ],
            $status
        );
    }

    public function errorResponse($data = [], $message = 'Something want Wrong!', $status = 500): JsonResponse
    {
        if (!env('APP_DEBUG')) {
            $message = 'Something want Wrong!';
            Log::error($message);
        }
        return response()->json(
            [
                'success' => false,
                'data' => $data,
                'message' => $message,
            ],
            $status
        );
    }
}
