<?php

namespace App\Http\Controllers;

use App\Models\BlogPost;
use Inertia\Inertia;
use Inertia\Response;

class BlogController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('blog/index', [
            'posts' => BlogPost::published()
                ->latest('published_at')
                ->paginate(9, ['id', 'title', 'slug', 'excerpt', 'published_at']),
        ]);
    }

    public function show(string $slug): Response
    {
        $blogPost = BlogPost::published()
            ->with('author:id,name')
            ->where('slug', $slug)
            ->firstOrFail();

        return Inertia::render('blog/show', [
            'post' => $blogPost->only([
                'id', 'title', 'slug', 'excerpt', 'body', 'published_at', 'author',
            ]),
        ]);
    }
}
