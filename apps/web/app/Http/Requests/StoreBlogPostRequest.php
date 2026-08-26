<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class StoreBlogPostRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return $this->user()?->is_admin === true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'excerpt' => ['required', 'string', 'max:500'],
            'body' => ['required', 'string'],
            'published' => ['required', 'boolean'],
        ];
    }

    /** @return array{title: string, excerpt: string, body: string, published: bool} */
    public function postData(): array
    {
        return [
            'title' => $this->string('title')->toString(),
            'excerpt' => $this->string('excerpt')->toString(),
            'body' => $this->string('body')->toString(),
            'published' => $this->boolean('published'),
        ];
    }
}
