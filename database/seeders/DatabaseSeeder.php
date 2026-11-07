<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $settings = ['business_name' => 'Forno Pizza & Bar', 'address' => '', 'phone' => '', 'timezone' => 'America/Toronto', 'kitchen_output' => 'screen', 'booking_minutes' => 120, 'tax_inclusive' => false, 'taxes' => [], 'receipt_footer' => 'Thank you. See you around the table.', 'kitchen_pin_hash' => Hash::make(bin2hex(random_bytes(16))), 'kitchen_version' => '1'];
        foreach ($settings as $name => $value) {
            DB::table('settings')->insertOrIgnore(['name' => $name, 'value' => json_encode($value), 'created_at' => now(), 'updated_at' => now()]);
        }
    }
}
