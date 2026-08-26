<?php

namespace App\Actions;

use App\Models\BlogPost;
use Illuminate\Support\Str;

class UpdateBlogPost
{
    /** @param array{title: string, excerpt: string, body: string, published: bool} $data */
    public function handle(BlogPost $blogPost, array $data): BlogPost
    {
        $blogPost->update([
            'title' => $data['title'],
            'slug' => $blogPost->title === $data['title']
                ? $blogPost->slug
                : $this->uniqueSlug($data['title'], $blogPost),
            'excerpt' => $data['excerpt'],
            'body' => $data['body'],
            'published_at' => $data['published']
                ? ($blogPost->published_at ?? now())
                : null,
        ]);

        return $blogPost->refresh();
    }

    private function uniqueSlug(string $title, BlogPost $blogPost): string
    {
        $baseSlug = Str::slug($title) ?: 'post';
        $slug = $baseSlug;
        $suffix = 2;

        while (BlogPost::where('slug', $slug)->whereKeyNot($blogPost->id)->exists()) {
            $slug = $baseSlug.'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }
}
