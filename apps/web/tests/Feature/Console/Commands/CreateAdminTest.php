<?php

namespace Tests\Feature\Console\Commands;

use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CreateAdminTest extends TestCase
{
    use LazilyRefreshDatabase;

    public function test_command_creates_verified_admin_account(): void
    {
        $this->artisan('app:create-admin', [
            'email' => 'owner@example.com',
            '--name' => 'Site Owner',
        ])
            ->expectsQuestion('Password (minimum 8 characters)', 'very-secure-password')
            ->assertSuccessful();

        $admin = User::where('email', 'owner@example.com')->firstOrFail();

        $this->assertSame('Site Owner', $admin->name);
        $this->assertTrue($admin->is_admin);
        $this->assertNotNull($admin->email_verified_at);
        $this->assertTrue(Hash::check('very-secure-password', $admin->password));
    }
}
