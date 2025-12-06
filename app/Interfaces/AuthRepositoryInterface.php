<?php

namespace App\Interfaces;

interface AuthRepositoryInterface
{
    public function login(string $email, string $password);
    public function register(array $data): array;
}
