<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

class BucketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'     => 'required|string|min:3|max:50'
        ];
    }
    public function messages(): array
    {
        return [
            'name.required' => 'Name is required',
            'name.min' => 'Name should minimum 3 charaters long',
            'name.max' => 'Name should not more then 50 charaters',
        ];
    }
    protected function failedValidation(Validator $validator)
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
