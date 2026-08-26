<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\WaitlistSubscriber;
use Symfony\Component\HttpFoundation\StreamedResponse;

class WaitlistExportController extends Controller
{
    public function __invoke(): StreamedResponse
    {
        return response()->streamDownload(function (): void {
            $output = fopen('php://output', 'w');

            if ($output === false) {
                return;
            }

            fputcsv($output, ['email', 'joined_at']);

            foreach (WaitlistSubscriber::oldest()->cursor() as $subscriber) {
                fputcsv($output, [$subscriber->email, $subscriber->created_at?->toIso8601String()]);
            }

            fclose($output);
        }, 'emzero-waitlist.csv', ['Content-Type' => 'text/csv']);
    }
}
