<?php

namespace Tests\Feature\Admin;

use App\Models\BlogPost;
use App\Models\User;
use App\Models\WaitlistSubscriber;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class DashboardControllerTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_non_admin_user_is_forbidden(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get(route('dashboard'))->assertForbidden();
    }

    public function test_admin_sees_content_counts(): void
    {
        $admin = User::factory()->admin()->create();
        WaitlistSubscriber::factory()->count(2)->create();
        BlogPost::factory()->create();
        BlogPost::factory()->draft()->create();

        $this->actingAs($admin)->get(route('dashboard'))
            ->assertInertia(fn (Assert $page) => $page
                ->component('admin/dashboard')
                ->where('stats.subscribers', 2)
                ->where('stats.publishedPosts', 1)
                ->where('stats.draftPosts', 1)
            );
    }
}
