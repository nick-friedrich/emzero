<?php

namespace App\Http\Controllers;

use App\Actions\SubscribeToWaitlist;
use App\Http\Requests\StoreWaitlistSubscriberRequest;
use Illuminate\Http\RedirectResponse;

class WaitlistSubscriberController extends Controller
{
    public function store(
        StoreWaitlistSubscriberRequest $request,
        SubscribeToWaitlist $subscribe,
    ): RedirectResponse {
        $subscribe->handle($request->string('email')->toString());

        return back()->with('success', "You're on the list. We'll keep you posted.");
    }
}
