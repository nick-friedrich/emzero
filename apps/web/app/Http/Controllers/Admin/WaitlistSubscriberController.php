<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\FilterWaitlistSubscribersRequest;
use App\Models\WaitlistSubscriber;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class WaitlistSubscriberController extends Controller
{
    public function index(FilterWaitlistSubscribersRequest $request): Response
    {
        $search = $request->string('search')->trim()->toString();

        return Inertia::render('admin/waitlist/index', [
            'subscribers' => WaitlistSubscriber::query()
                ->when($search !== '', fn ($query) => $query->where('email', 'like', '%'.$search.'%'))
                ->latest()
                ->paginate(25)
                ->withQueryString(),
            'filters' => ['search' => $search],
        ]);
    }

    public function destroy(WaitlistSubscriber $waitlistSubscriber): RedirectResponse
    {
        $waitlistSubscriber->delete();

        return back()->with('success', 'Subscriber removed.');
    }
}
