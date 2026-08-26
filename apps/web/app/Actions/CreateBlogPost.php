<?php

namespace App\Actions;

use App\Models\BlogPost;
use App\Models\User;
use Illuminate\Support\Str;

class CreateBlogPost
{
    /** @param array{title: string, excerpt: string, body: string, published: bool} $data */
    public function handle(User $author, array $data): BlogPost
    {
        return BlogPost::create([
            'user_id' => $author->id,
            'title' => $data['title'],
            'slug' => $this->uniqueSlug($data['title']),
            'excerpt' => $data['excerpt'],
            'body' => $data['body'],
            'published_at' => $data['published'] ? now() : null,
        ]);
    }

    private function uniqueSlug(string $title): string
    {
        $baseSlug = Str::slug($title) ?: 'post';
        $slug = $baseSlug;
        $suffix = 2;

        while (BlogPost::where('slug', $slug)->exists()) {
            $slug = $baseSlug.'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }
}
