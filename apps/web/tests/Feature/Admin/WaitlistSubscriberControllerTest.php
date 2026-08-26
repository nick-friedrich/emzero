<?php

namespace Tests\Feature\Admin;

use App\Models\User;
use App\Models\WaitlistSubscriber;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class WaitlistSubscriberControllerTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_admin_can_search_subscribers(): void
    {
        $admin = User::factory()->admin()->create();
        WaitlistSubscriber::factory()->create(['email' => 'match@example.com']);
        WaitlistSubscriber::factory()->create(['email' => 'other@example.com']);

        $this->actingAs($admin)->get(route('admin.waitlist.index', ['search' => 'match']))
            ->assertInertia(fn (Assert $page) => $page
                ->component('admin/waitlist/index')
                ->has('subscribers.data', 1)
                ->where('subscribers.data.0.email', 'match@example.com')
            );
    }

    public function test_admin_can_remove_subscriber(): void
    {
        $admin = User::factory()->admin()->create();
        $subscriber = WaitlistSubscriber::factory()->create();

        $this->actingAs($admin)->delete(route('admin.waitlist.destroy', $subscriber))
            ->assertRedirect()
            ->assertSessionHas('success');

        $this->assertModelMissing($subscriber);
    }

    public function test_admin_can_export_subscribers_as_csv(): void
    {
        $admin = User::factory()->admin()->create();
        WaitlistSubscriber::factory()->create(['email' => 'export@example.com']);

        $response = $this->actingAs($admin)->get(route('admin.waitlist.export'));

        $response->assertDownload('emzero-waitlist.csv');
        $this->assertStringContainsString('export@example.com', $response->streamedContent());
    }
}
