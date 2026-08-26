<?php

namespace Database\Seeders;

use App\Models\BlogPost;
use App\Models\User;
use Illuminate\Database\Seeder;

class BlogPostSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $admin = User::where('is_admin', true)->firstOr(
            fn (): User => User::factory()->admin()->create([
                'name' => 'Emzero Admin',
                'email' => 'admin@example.com',
            ]),
        );

        BlogPost::factory()->for($admin, 'author')->count(3)->create();
        BlogPost::factory()->for($admin, 'author')->draft()->create();
    }
}
