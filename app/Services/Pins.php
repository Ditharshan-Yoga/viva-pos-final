<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class Pins
{
    /** Call within a transaction; the settings row serializes PIN changes. */
    public static function ensureUnique(string $pin, ?int $exceptUser = null, bool $kitchen = false): void
    {
        DB::table('settings')->where('name', 'business_name')->lockForUpdate()->first();
        foreach (User::query()->when($exceptUser, fn ($q) => $q->where('id', '!=', $exceptUser))->get(['pin_hash']) as $user) {
            Support::fail($user->pin_hash && Hash::check($pin, $user->pin_hash), 'This PIN is already in use. Choose another PIN.');
        }
        $hash = Support::settings()['kitchen_pin_hash'] ?? null;
        Support::fail(! $kitchen && $hash && Hash::check($pin, $hash), 'This PIN is already in use. Choose another PIN.');
    }
}
