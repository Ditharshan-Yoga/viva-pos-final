<?php

use App\Models\User;
use App\Services\Pins;
use App\Services\Support;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

Artisan::command('pos:manager {--name=} {--employee=MANAGER}', function () {
    if (User::where('role', 'manager')->exists()) {
        $this->error('A Manager already exists.');

        return 1;
    }
    $name = $this->option('name') ?: $this->ask('Manager name');
    $pin = $this->secret('Choose a 4 to 8 digit PIN');
    if (! preg_match('/^\d{4,8}$/D', $pin ?? '')) {
        $this->error('PIN must have 4 to 8 digits.');

        return 1;
    }
    DB::beginTransaction();
    Pins::ensureUnique($pin);
    Support::fail(User::where('role', 'manager')->exists(), 'A Manager already exists.');
    $user = new User;
    $user->name = $name;
    $user->employee_id = $this->option('employee');
    $user->email = 'manager@staff.invalid';
    $user->role = 'manager';
    $user->active = true;
    $user->pin_hash = Hash::make($pin);
    $user->password = Hash::make(bin2hex(random_bytes(32)));
    $user->save();
    DB::commit();
    $this->info('Manager created. Sign in and configure taxes and kitchen PIN.');
})->purpose('Provision the single Manager account');
Artisan::command('pos:demo', function () {
    if (! app()->environment('local', 'testing')) {
        $this->error('Demo seed is only available locally.');

        return 1;
    }if (User::exists()) {
        $this->error('Demo requires an empty user table.');

        return 1;
    }
    $this->call('db:seed', ['--force' => true]);
    foreach ([['Alex Morgan', 'manager', '1001', '4826'], ['Jamie Lee', 'admin', '1002', '5937'], ['Taylor Brooks', 'cashier', '1003', '6148']] as [$name,$role,$employee,$pin]) {
        $u = new User;
        $u->name = $name;
        $u->role = $role;
        $u->employee_id = $employee;
        $u->email = $employee.'@staff.invalid';
        $u->password = Hash::make(bin2hex(random_bytes(16)));
        $u->pin_hash = Hash::make($pin);
        $u->active = true;
        $u->save();
    }
    DB::table('settings')->where('name', 'kitchen_pin_hash')->update(['value' => json_encode(Hash::make('7259'))]);
    foreach (['Pizza', 'Sides', 'Drinks', 'Bar'] as $name) {
        DB::table('categories')->insert(['name' => $name, 'created_at' => now(), 'updated_at' => now()]);
    }
    $rows = [['Margherita', 1, 1490, true], ['Pepperoni', 1, 1790, true], ['BBQ Chicken', 1, 1990, true], ['Four Cheese', 1, 1890, true], ['Garden Pizza', 1, 1690, true], ['Spicy Salami', 1, 1990, true], ['Garlic Bread', 2, 650, true], ['Baked Wings', 2, 1290, true], ['Classic Cola', 3, 350, false], ['Sparkling Water', 3, 300, false], ['Draft Lager', 4, 750, false], ['House Red', 4, 900, false]];
    foreach ($rows as [$name,$cat,$price,$kitchen]) {
        DB::table('products')->insert(['name' => $name, 'category_id' => $cat, 'department' => $cat === 4 ? 'bar' : 'restaurant', 'price_cents' => $price, 'kitchen' => $kitchen, 'variants' => json_encode($cat === 1 ? [['name' => 'Regular', 'price_cents' => $price], ['name' => 'Large', 'price_cents' => $price + 400]] : []), 'modifiers' => json_encode($cat === 1 ? [['name' => 'Extra cheese', 'price_cents' => 200], ['name' => 'Mushrooms', 'price_cents' => 150]] : []), 'created_at' => now(), 'updated_at' => now()]);
    }
    foreach (range(1, 8) as $n) {
        DB::table('dining_tables')->insert(['name' => 'Table '.str_pad($n, 2, '0', STR_PAD_LEFT), 'seats' => $n > 6 ? 6 : 4, 'created_at' => now(), 'updated_at' => now()]);
    }
    DB::table('terminals')->insert(['name' => 'Front counter', 'identifier' => 'TERM-01', 'location' => 'Counter', 'created_at' => now(), 'updated_at' => now()]);
    DB::table('promotions')->insert(['name' => 'Lunch special', 'type' => 'percent', 'value' => 1000, 'created_at' => now(), 'updated_at' => now()]);
    $this->info('Demo ready: Manager 4826, Admin 5937, Cashier 6148, Kitchen 7259. Taxes are unconfigured. Never use demo credentials in production.');
})->purpose('Seed a local-only demonstration');
