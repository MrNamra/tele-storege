<?php

namespace App\Trait;

use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\JsonResponse;

trait ApiResponseTrait
{
    public function successResponse($data = [], $message = 'Fetch Successful', $status = 200, $pagination = null, $totalStorage = null): JsonResponse
    {
        $payload = [
            'success' => true,
            'data' => $data,
            'message' => $message,
        ];

        if ($pagination !== null) {
            $payload['pagination'] = $pagination;
        }

        if ($totalStorage !== null) {
            $payload['totalStorage'] = $totalStorage;
        }

        return response()->json($payload, $status);
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
