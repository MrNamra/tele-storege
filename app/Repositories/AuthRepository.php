<?php

namespace App\Repositories;

use App\Interfaces\AuthRepositoryInterface;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

class AuthRepository implements AuthRepositoryInterface
{
    public function login(string $email, string $password)
    {
        $user = User::firstWhere(["email" => $email]);
        if ($user && Hash::check($password, $user->password)) {
            $token = $user->createToken('AppToken')->plainTextToken;
            return [
                'data' => [
                    'token' => $token,
                ],
                'message' => 'Login Successful!'
            ];
        }

        return [
            'message' => 'Email and Password does not match with data'
        ];
    }

    public function register(array $data): array
    {
        User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => bcrypt($data['password']),
        ]);
        return ['message' => 'User Created successfully!'];
    }

    public function profile(): array
    {
        return Auth::user()->only(['id', 'name', 'email', 'bucketAllowed']);
    }

    public function updateProfile(array $data): void
    {
        User::update(
            [
            'id' => Auth::id()
        ],
            [
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => bcrypt($data['password']),
        ]
        );
    }

    public function dashboard(): array
    {
        return [
            'user' => $this->profile(),
            'bucket' => Auth::user()->bucket,
            'totalBuckets' => Auth::user()->bucketCount,
        ];
    }
}
