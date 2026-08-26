<?php

namespace Tests\Feature;

use App\Models\BlogPost;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class BlogControllerTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_index_excludes_draft_posts(): void
    {
        BlogPost::factory()->create(['title' => 'Public story']);
        BlogPost::factory()->draft()->create(['title' => 'Draft story']);

        $this->get(route('blog.index'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('blog/index')
                ->has('posts.data', 1)
                ->where('posts.data.0.title', 'Public story')
            );
    }

    public function test_published_post_can_be_read(): void
    {
        $post = BlogPost::factory()->create(['title' => 'A public story']);

        $this->get(route('blog.show', $post->slug))
            ->assertInertia(fn (Assert $page) => $page
                ->component('blog/show')
                ->where('post.title', 'A public story')
            );
    }

    public function test_draft_post_returns_not_found(): void
    {
        $post = BlogPost::factory()->draft()->create();

        $this->get(route('blog.show', $post->slug))->assertNotFound();
    }
}
