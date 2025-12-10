<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class FileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'bucket_id' => 'required|exists:buckets,id',
            'files' => 'required|array',
            'files.*' => 'required|file|max:2048000',
        ];
    }

    public function messages(): array
    {
        return [
            'bucket_id.required' => 'Please Select Bucket',
            'bucket_id.exists' => 'Bucket not found',
            'files.required' => 'Please upload at least one file.',
            'files.array' => 'Files must be uploaded as an array.',
            'files.*.required' => 'Each file is required.',
            'files.*.file' => 'Each item must be a valid file.',
            'files.*.max' => 'Each file must not exceed 2 GB.',
        ];
    }

    public function failedValidation(Validator $validator)
    {
        throw new HttpResponseException(
            response()->json([
                'success' => false,
                'message' => 'Validation Fail',
                'error' => $validator->errors(),
            ], 422)
        );
    }
}
