<?php

namespace App\Actions;

use App\Models\WaitlistSubscriber;
use Illuminate\Support\Str;

class SubscribeToWaitlist
{
    public function handle(string $email): WaitlistSubscriber
    {
        return WaitlistSubscriber::firstOrCreate([
            'email' => Str::lower($email),
        ]);
    }
}
