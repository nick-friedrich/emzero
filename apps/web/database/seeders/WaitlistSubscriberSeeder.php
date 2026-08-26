<?php

namespace Database\Seeders;

use App\Models\WaitlistSubscriber;
use Illuminate\Database\Seeder;

class WaitlistSubscriberSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        WaitlistSubscriber::factory()->count(12)->create();
    }
}
