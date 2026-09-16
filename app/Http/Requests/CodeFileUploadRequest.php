<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class CodeFileUploadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'password' => 'required|min:4',
            'files' => 'required|array',
            'files.*' => 'required|file|max:2048000',
        ];
    }

    public function messages(): array
    {
        return [
            'password.required' => 'Wrong Password!',
            'password.min' => 'Wrong Password!',
            'files.required' => 'Please upload at least one file.',
            'files.array' => 'Files must be uploaded as an array.',
            'files.*.required' => 'Each file is required.',
            'files.*.file' => 'Each item must be a valid file.',
            'files.*.max' => 'Each file must not exceed 2 GB.',
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
