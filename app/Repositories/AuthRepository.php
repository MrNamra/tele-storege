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
        $user = User::firstWhere(['email' => $email]);
        if ($user && Hash::check($password, $user->password)) {
            if ($user->isSuspended()) {
                return [
                    'message' => 'Your account has been suspended. Please contact the administrator.',
                ];
            }

            $user->forceFill(['last_login_at' => now()])->save();

            $token = $user->createToken('AppToken')->plainTextToken;

            return [
                'data' => [
                    'token' => $token,
                    'user' => [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'status' => $user->status,
                        'bucketAllowed' => $user->bucketAllowed,
                    ],
                ],
                'message' => 'Login Successful!',
            ];
        }

        return [
            'message' => 'Email and Password does not match with data',
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
        return Auth::user()->only(['id', 'name', 'email', 'role', 'status', 'bucketAllowed', 'last_login_at']);
    }

    public function updateProfile(array $data): void
    {
        User::update(
            [
                'id' => Auth::id(),
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
