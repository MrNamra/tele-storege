<?php

namespace App\Http\Requests;

use App\Models\Bucket;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Vinkla\Hashids\Facades\Hashids;

class FileRequest extends FormRequest
{
    protected ?Bucket $bucket = null;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation()
    {
        try {
            // $decoded = Hashids::decode($this->bucket_id);

            // if (empty($decoded)) {
            //     throw new \Exception();
            // }

            $bucket = Bucket::where('id', $this->bucket_id)
                ->where('user_id', auth()->id())
                ->first();

            if (! $bucket) {
                throw new \Exception;
            }

            $this->merge([
                'bucket_id' => $bucket->id,
            ]);

            $this->bucket = $bucket;

        } catch (\Throwable $e) {
            throw new HttpResponseException(
                response()->json([
                    'success' => false,
                    'message' => 'Bucket not found',
                ], 404)
            );
        }
    }

    public function rules(): array
    {
        return [
            'bucket_id' => 'required',
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
                'message' => $validator->errors()->first(),
                'error' => $validator->errors(),
            ], 422)
        );
    }

    public function bucket(): Bucket
    {
        return $this->bucket;
    }
}
