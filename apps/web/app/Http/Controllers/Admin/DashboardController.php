<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\BlogPost;
use App\Models\WaitlistSubscriber;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __invoke(): Response
    {
        return Inertia::render('admin/dashboard', [
            'stats' => [
                'subscribers' => WaitlistSubscriber::count(),
                'publishedPosts' => BlogPost::published()->count(),
                'draftPosts' => BlogPost::whereNull('published_at')->count(),
            ],
            'recentSubscribers' => WaitlistSubscriber::latest()->limit(5)->get(),
            'recentPosts' => BlogPost::latest()->limit(5)->get([
                'id', 'title', 'slug', 'published_at', 'updated_at',
            ]),
        ]);
    }
}
