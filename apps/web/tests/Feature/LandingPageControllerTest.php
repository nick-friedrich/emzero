<?php

namespace Tests\Feature;

use App\Models\BlogPost;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class LandingPageControllerTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_landing_page_shows_only_recent_published_posts(): void
    {
        BlogPost::factory()->create(['title' => 'Published note']);
        BlogPost::factory()->draft()->create(['title' => 'Private draft']);

        $this->get(route('home'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('home')
                ->has('posts', 1)
                ->where('posts.0.title', 'Published note')
            );
    }
}
