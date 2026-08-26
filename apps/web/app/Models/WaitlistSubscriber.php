<?php

namespace App\Models;

use Database\Factories\WaitlistSubscriberFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['email'])]
class WaitlistSubscriber extends Model
{
    /** @use HasFactory<WaitlistSubscriberFactory> */
    use HasFactory;
}
