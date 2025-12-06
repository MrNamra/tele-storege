<?php

namespace App\Interfaces;

interface AuthRepositoryInterface
{
    public function login(string $email, string $password);
    public function register(array $data): array;
    public function profile(): array;
    public function updateProfile(array $data): void;
    public function dashboard(): array;
}
