<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Interfaces\AuthRepositoryInterface;
use App\Trait\ApiResponseTrait;
use Symfony\Component\HttpFoundation\JsonResponse;

class AuthController extends Controller
{
    use ApiResponseTrait;

    protected $authRepo;

    public function __construct(AuthRepositoryInterface $authRepo)
    {
        $this->authRepo = $authRepo;
    }
    public function register(RegisterRequest $request): JsonResponse
    {
        try {
            $data = $this->authRepo->register($request->all());
            return $this->successResponse(message: $data['message']);
        } catch (\Exception $e) {
            return $this->errorResponse(message: $e->getMessage());
        }
    }
    public function login(LoginRequest $request)
    {
        try {
            $response = $this->authRepo->login(email: $request->email, password: $request->password);
            return !empty($response['data']) ?
                $this->successResponse(data: $response['data'] ?? [], message: $response['message']) :
                $this->errorResponse(message: $response['message'], status: 422);
        } catch (\Exception $e) {
            return $this->errorResponse(message: $e->getMessage());
        }
    }
}
