<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class CodeFileDownloadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'password' => 'required|min:4',
            'file_id' => 'required|string',
        ];
    }

    public function messages(): array
    {
        return [
            'password.required' => 'Wrong Password!',
            'password.min' => 'Wrong Password!',
            'file_id.required' => 'File ID is required.',
            'file_id.string' => 'File ID must be a string.',
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
