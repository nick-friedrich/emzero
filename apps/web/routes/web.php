<?php

use App\Http\Controllers\Admin\BlogPostController as AdminBlogPostController;
use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\WaitlistExportController;
use App\Http\Controllers\Admin\WaitlistSubscriberController as AdminWaitlistSubscriberController;
use App\Http\Controllers\BlogController;
use App\Http\Controllers\LandingPageController;
use App\Http\Controllers\WaitlistSubscriberController;
use Illuminate\Support\Facades\Route;

Route::get('/', LandingPageController::class)->name('home');
Route::post('/waitlist', [WaitlistSubscriberController::class, 'store'])
    ->middleware('throttle:waitlist')
    ->name('waitlist.store');

Route::get('/blog', [BlogController::class, 'index'])->name('blog.index');
Route::get('/blog/{slug}', [BlogController::class, 'show'])->name('blog.show');

Route::middleware(['auth', 'verified', 'can:access-admin'])->group(function () {
    Route::get('/dashboard', DashboardController::class)->name('dashboard');

    Route::prefix('admin')->name('admin.')->group(function () {
        Route::get('waitlist/export', WaitlistExportController::class)->name('waitlist.export');
        Route::resource('waitlist', AdminWaitlistSubscriberController::class)
            ->only(['index', 'destroy'])
            ->parameters(['waitlist' => 'waitlistSubscriber']);
        Route::resource('posts', AdminBlogPostController::class)
            ->except(['show'])
            ->parameters(['posts' => 'blogPost']);
    });
});

require __DIR__.'/settings.php';
