<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class ShareBucketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'bucket_id' => 'required',
            'password' => 'nullable|min:4',
            'expiresAt' => 'nullable|date',
        ];
    }

    public function messages(): array
    {
        return [
            'bucket_id.required' => 'Finding Bucket Fail',
            'email.email' => 'Enter a valid email address',
            'password.min' => 'Password must be at least 4 characters',
            'expiresAt.date' => 'Expired Time Should be date',
        ];
    }

    protected function failedValidation(Validator $validator)
    {
        throw new HttpResponseException(
            response()->json([
                'success' => false,
                'data' => [],
                'message' => $validator->errors()->first(),
            ], 422)
        );
    }
}
