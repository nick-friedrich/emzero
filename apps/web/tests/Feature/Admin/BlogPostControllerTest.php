<?php

namespace Tests\Feature\Admin;

use App\Models\BlogPost;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

class BlogPostControllerTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_admin_can_create_published_post(): void
    {
        $admin = User::factory()->admin()->create();

        $response = $this->actingAs($admin)->post(route('admin.posts.store'), [
            'title' => 'A calmer inbox',
            'excerpt' => 'Why focus is the feature that matters.',
            'body' => 'Long-form product notes.',
            'published' => true,
        ]);

        $response->assertRedirect(route('admin.posts.index'))->assertSessionHas('success');
        $this->assertDatabaseHas('blog_posts', [
            'title' => 'A calmer inbox',
            'slug' => 'a-calmer-inbox',
        ]);
        $this->assertNotNull(BlogPost::firstOrFail()->published_at);
    }

    public function test_admin_can_update_post_to_draft(): void
    {
        $admin = User::factory()->admin()->create();
        $post = BlogPost::factory()->create();

        $response = $this->actingAs($admin)->put(route('admin.posts.update', $post), [
            'title' => 'Revised title',
            'excerpt' => 'A revised excerpt.',
            'body' => 'Revised body.',
            'published' => false,
        ]);

        $response->assertRedirect(route('admin.posts.index'));
        $this->assertDatabaseHas('blog_posts', [
            'id' => $post->id,
            'title' => 'Revised title',
            'slug' => 'revised-title',
            'published_at' => null,
        ]);
    }

    public function test_admin_can_delete_post(): void
    {
        $admin = User::factory()->admin()->create();
        $post = BlogPost::factory()->create();

        $this->actingAs($admin)->delete(route('admin.posts.destroy', $post))
            ->assertRedirect()
            ->assertSessionHas('success');

        $this->assertModelMissing($post);
    }

    public function test_invalid_post_is_rejected_without_creating_record(): void
    {
        $admin = User::factory()->admin()->create();

        $response = $this->actingAs($admin)->post(route('admin.posts.store'), [
            'title' => '',
            'excerpt' => '',
            'body' => '',
            'published' => true,
        ]);

        $response->assertSessionHasErrors(['title', 'excerpt', 'body']);
        $this->assertDatabaseCount('blog_posts', 0);
    }
}
