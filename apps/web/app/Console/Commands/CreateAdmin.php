<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

#[Signature('app:create-admin {email? : The admin email address} {--name= : The admin display name}')]
#[Description('Create or promote an administrator account')]
class CreateAdmin extends Command
{
    public function handle(): int
    {
        $email = (string) ($this->argument('email') ?: $this->ask('Admin email'));
        $name = (string) ($this->option('name') ?: Str::headline(Str::before($email, '@')));
        $password = (string) $this->secret('Password (minimum 8 characters)');

        $validated = Validator::make([
            'email' => Str::lower($email),
            'name' => $name,
            'password' => $password,
        ], [
            'email' => ['required', 'email:rfc', 'max:255'],
            'name' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8'],
        ])->validate();

        $admin = User::updateOrCreate(
            ['email' => $validated['email']],
            [
                'name' => $validated['name'],
                'password' => Hash::make($validated['password']),
            ],
        );

        $admin->forceFill([
            'email_verified_at' => now(),
            'is_admin' => true,
        ])->save();

        $this->components->info('Admin account is ready.');

        return self::SUCCESS;
    }
}
