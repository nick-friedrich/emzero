<?php

namespace App\Http\Controllers\Admin;

use App\Actions\CreateBlogPost;
use App\Actions\UpdateBlogPost;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreBlogPostRequest;
use App\Http\Requests\UpdateBlogPostRequest;
use App\Models\BlogPost;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class BlogPostController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(): Response
    {
        return Inertia::render('admin/posts/index', [
            'posts' => BlogPost::latest()->paginate(20, [
                'id', 'title', 'slug', 'published_at', 'updated_at',
            ]),
        ]);
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create(): Response
    {
        return Inertia::render('admin/posts/create');
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreBlogPostRequest $request, CreateBlogPost $create): RedirectResponse
    {
        $create->handle($request->user(), $request->postData());

        return to_route('admin.posts.index')->with('success', 'Post created.');
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(BlogPost $blogPost): Response
    {
        return Inertia::render('admin/posts/edit', [
            'post' => $blogPost->only(['id', 'title', 'slug', 'excerpt', 'body', 'published_at']),
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(
        UpdateBlogPostRequest $request,
        BlogPost $blogPost,
        UpdateBlogPost $update,
    ): RedirectResponse {
        $update->handle($blogPost, $request->postData());

        return to_route('admin.posts.index')->with('success', 'Post updated.');
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(BlogPost $blogPost): RedirectResponse
    {
        $blogPost->delete();

        return back()->with('success', 'Post deleted.');
    }
}
