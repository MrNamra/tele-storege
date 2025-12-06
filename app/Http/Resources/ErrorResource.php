<?php

namespace App\Http\Resources;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ErrorResource extends JsonResource
{
    protected $statusCode;

    public function __construct($resource, $statusCode = 500)
    {
        parent::__construct($resource);
        $this->statusCode = $statusCode;
    }

    public function toArray(Request $request): array
    {
        return [
            'success' => false,
            'data' => [],
            'message' => $this->resource,
        ];
    }

    public function withResponse(Request $request, $response)
    {
        return parent::withResponse($request, $response);
    }
}
