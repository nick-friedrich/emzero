<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Tests\TestCase;

class WaitlistSubscriberControllerTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_valid_email_joins_waitlist_and_redirects_back(): void
    {
        $response = $this->from(route('home'))->post(route('waitlist.store'), [
            'email' => 'Person@Example.com',
        ]);

        $response->assertRedirect(route('home'))->assertSessionHas('success');
        $this->assertDatabaseHas('waitlist_subscribers', ['email' => 'person@example.com']);
    }

    public function test_duplicate_email_is_idempotent(): void
    {
        $this->post(route('waitlist.store'), ['email' => 'person@example.com']);

        $this->post(route('waitlist.store'), ['email' => 'person@example.com'])
            ->assertSessionHasNoErrors();

        $this->assertDatabaseCount('waitlist_subscribers', 1);
    }

    public function test_invalid_email_is_rejected_without_creating_subscriber(): void
    {
        $response = $this->from(route('home'))->post(route('waitlist.store'), [
            'email' => 'not-an-email',
        ]);

        $response->assertRedirect(route('home'))->assertSessionHasErrors('email');
        $this->assertDatabaseCount('waitlist_subscribers', 0);
    }
}
