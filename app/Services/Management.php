<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class Management
{
    public function run(string $action, Request $r): mixed
    {
        return DB::transaction(function () use ($action, $r) {
            if (str_starts_with($action, 'reservation.')) {
                return $this->reservation($action, $r);
            }
            if ($action === 'day.submit') {
                $day = Support::day();
                $summary = (new Reports)->summary($day->id, Auth::id());
                DB::table('daily_summaries')->updateOrInsert(['business_day_id' => $day->id, 'user_id' => Auth::id()], ['summary' => json_encode($summary), 'submitted_at' => now()]);
                Support::audit('day.summary_submitted', "Day $day->id");

                return null;
            }
            Support::manager();
            if (str_starts_with($action, 'day.')) {
                DB::table('settings')->where('name', 'business_name')->lockForUpdate()->first();
                if ($action === 'day.open') {
                    Support::fail(DB::table('business_days')->where('status', 'open')->exists(), 'A business day is already open.');
                    $id = DB::table('business_days')->insertGetId(['business_date' => now()->timezone(Support::settings()['timezone'] ?? 'America/Toronto')->toDateString(), 'opened_by' => Auth::id(), 'opened_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
                    Support::audit('day.opened', "Day $id");
                } elseif ($action === 'day.close') {
                    $day = Support::day();
                    Support::fail(DB::table('orders')->where('status', 'open')->exists(), 'Complete or cancel all unpaid orders before closing.');
                    $summary = (new Reports)->summary($day->id);
                    DB::table('business_days')->where('id', $day->id)->update(['status' => 'closed', 'closed_by' => Auth::id(), 'closed_at' => now(), 'closing_snapshot' => json_encode($summary), 'updated_at' => now()]);
                    Support::audit('day.closed', "Day $day->id", $summary);
                } elseif ($action === 'day.reopen') {
                    $v = $r->validate(['day_id' => 'required|integer|exists:business_days,id', 'reason' => 'required|string|min:3|max:300']);
                    Support::fail(DB::table('business_days')->where('status', 'open')->exists(), 'Close the current day before reopening a day.');
                    $latest = DB::table('business_days')->latest('id')->first();
                    Support::fail($latest->id !== $v['day_id'], 'Only the most recent closed day can be reopened.');
                    DB::table('business_days')->where('id', $v['day_id'])->update(['status' => 'open', 'updated_at' => now()]);
                    Support::audit('day.reopened', "Day {$v['day_id']}", ['reason' => $v['reason'], 'previous_closing_snapshot' => json_decode($latest->closing_snapshot, true)]);
                } else {
                    abort(404);
                }

                return null;
            }
            if ($action === 'user.save') {
                $v = $r->validate(['id' => 'nullable|integer|exists:users,id', 'name' => 'required|string|max:100', 'employee_id' => 'required|string|max:30', 'role' => 'required|in:admin,cashier', 'pin' => 'nullable|digits_between:4,8', 'active' => 'required|boolean']);
                $old = isset($v['id']) ? User::find($v['id']) : null;
                Support::fail($old?->role === 'manager', 'The Manager account cannot be changed here.');
                abort_if(Auth::user()->role === 'admin' && ($v['role'] !== 'cashier' || ($old && $old->role !== 'cashier')), 403);
                Support::fail(User::where('employee_id', $v['employee_id'])->when($old, fn ($q) => $q->where('id', '!=', $old->id))->exists(), 'Employee ID already exists.');
                Support::fail(! $old && empty($v['pin']), 'Enter a PIN for the new employee.');
                if (! empty($v['pin'])) {
                    Pins::ensureUnique($v['pin'], $old?->id);
                }$user = $old ?? new User;
                $user->name = $v['name'];
                $user->employee_id = $v['employee_id'];
                $user->role = $v['role'];
                $user->active = $v['active'];
                if (! empty($v['pin'])) {
                    $user->pin_hash = Hash::make($v['pin']);
                }if (! $old) {
                    $user->email = strtolower($v['employee_id']).'@staff.invalid';
                    $user->password = Hash::make(bin2hex(random_bytes(32)));
                }$user->save();
                if (! $user->active || ! empty($v['pin'])) {
                    DB::table('staff_sessions')->where('user_id', $user->id)->whereNull('ended_at')->update(['ended_at' => now(), 'end_reason' => 'account_changed']);
                }
                Support::audit($old ? 'user.updated' : 'user.created', "Employee $user->id", ['name' => $user->name, 'role' => $user->role, 'active' => $user->active]);

                return null;
            }
            if ($action === 'extras.save') {
                $v = $r->validate(['id' => 'nullable|integer|exists:extra_groups,id', 'name' => 'required|string|max:80', 'modifiers' => 'required|array|max:20', 'modifiers.*.name' => 'required|string|max:80|distinct', 'modifiers.*.price_cents' => 'required|integer|min:0|max:999999']);
                if (! empty($v['id'])) {
                    Support::fail(! DB::table('extra_groups')->where('id', $v['id'])->lockForUpdate()->first(), 'This extras list no longer exists. Refresh and try again.');
                }
                $this->save('extra_groups', $v['id'] ?? null, ['name' => $v['name'], 'modifiers' => json_encode($v['modifiers'])]);
                Support::audit('extras.updated', $v['name']);

                return null;
            }
            if ($action === 'extras.delete') {
                $v = $r->validate(['id' => 'required|integer|exists:extra_groups,id']);
                $group = DB::table('extra_groups')->where('id', $v['id'])->lockForUpdate()->first();
                Support::fail(! $group, 'This extras list no longer exists. Refresh and try again.');
                Support::fail(DB::table('products')->where(fn ($q) => $q->where('extra_group_id', $v['id'])->orWhereJsonContains('extra_group_ids', (int) $v['id'])->orWhereJsonContains('extra_group_ids', (string) (int) $v['id']))->exists(), 'Remove this extras list from all products before deleting it.');
                DB::table('extra_groups')->where('id', $v['id'])->delete();
                Support::audit('extras.deleted', $group->name, ['id' => $group->id]);

                return null;
            }
            if ($action === 'product.save') {
                $extraSelection = $r->validate(['extra_group_ids' => 'sometimes|array|max:50', 'extra_group_ids.*' => 'integer|distinct|exists:extra_groups,id']);
                $selectedIds = $extraSelection['extra_group_ids'] ?? ($r->filled('extra_group_id') ? [$r->integer('extra_group_id')] : []);
                $selectedIds = array_values(array_unique(array_map('intval', $selectedIds)));
                if ($r->input('department', 'restaurant') === 'bar') {
                    $selectedIds = [];
                }
                foreach ($selectedIds as $groupId) {
                    Support::fail(! DB::table('extra_groups')->where('id', $groupId)->lockForUpdate()->first(), 'An extras list no longer exists. Refresh and select again.');
                }
                $v = $r->validate(['id' => 'nullable|integer|exists:products,id', 'name' => 'required|string|max:100', 'category_id' => 'required|integer|exists:categories,id', 'price' => 'required', 'department' => 'sometimes|in:restaurant,bar', 'takeout_price' => 'nullable', 'extra_group_id' => 'nullable|integer|exists:extra_groups,id', 'photo' => 'nullable|string|max:220000', 'kitchen' => 'required|boolean', 'active' => 'required|boolean', 'variants' => 'array|max:10', 'variants.*.name' => 'required|string|max:80', 'variants.*.price_cents' => 'required|integer|min:0|max:999999', 'modifiers' => 'array|max:20', 'modifiers.*.name' => 'required|string|max:80', 'modifiers.*.price_cents' => 'required|integer|min:0|max:999999']);
                if (! empty($v['extra_group_id'])) {
                    Support::fail(! DB::table('extra_groups')->where('id', $v['extra_group_id'])->lockForUpdate()->first(), 'This extras list no longer exists. Choose another list.');
                }
                if (! empty($v['photo'])) {
                    Support::fail(! preg_match('#^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$#D', $v['photo']), 'Choose a JPEG, PNG or WebP photo.');
                    $image = base64_decode(explode(',', $v['photo'], 2)[1], true);
                    $info = $image ? @getimagesizefromstring($image) : false;
                    Support::fail(! $info || ! in_array($info['mime'], ['image/jpeg', 'image/png', 'image/webp']) || $info[0] > 3000 || $info[1] > 3000, 'Photo must be a valid image up to 3000 pixels.');
                }
                $data = ['extra_group_ids' => json_encode($selectedIds), 'extra_group_id' => $selectedIds[0] ?? null, 'department' => $v['department'] ?? 'restaurant', 'takeout_price_cents' => isset($v['takeout_price']) ? Money::cents($v['takeout_price']) : null, 'photo' => $v['photo'] ?? null, 'name' => $v['name'], 'category_id' => $v['category_id'], 'price_cents' => Money::cents($v['price']), 'kitchen' => $v['kitchen'], 'active' => $v['active'], 'variants' => json_encode($v['variants'] ?? []), 'modifiers' => json_encode($v['modifiers'] ?? []), 'updated_at' => now()];
                $this->save('products', $v['id'] ?? null, $data);
                Support::audit('menu.updated', $v['name']);

                return null;
            }
            if ($action === 'category.save') {
                $v = $r->validate(['name' => 'required|string|max:60|unique:categories,name']);
                DB::table('categories')->insert([...$v, 'created_at' => now(), 'updated_at' => now()]);
                Support::audit('category.created', $v['name']);

                return null;
            }
            if ($action === 'table.save') {
                $v = $r->validate(['id' => 'nullable|integer|exists:dining_tables,id', 'name' => 'required|string|max:30', 'seats' => 'required|integer|min:1|max:50', 'area' => 'sometimes|required|string|max:60', 'department' => 'sometimes|in:restaurant,bar', 'active' => 'required|boolean']);
                Support::fail(DB::table('dining_tables')->where('name', $v['name'])->when(isset($v['id']), fn ($q) => $q->where('id', '!=', $v['id']))->exists(), 'Table name already exists.');
                if (isset($v['id'])) {
                    DB::table('dining_tables')->where('id', $v['id'])->lockForUpdate()->first();
                    Support::fail(! $v['active'] && (DB::table('orders')->where('dining_table_id', $v['id'])->where('status', 'open')->exists() || DB::table('reservations')->where('dining_table_id', $v['id'])->where('status', 'upcoming')->where('ends_at', '>', now())->exists()), 'This table has open orders or future reservations.');
                }$id = $v['id'] ?? null;
                unset($v['id']);
                $this->save('dining_tables', $id, $v);
                Support::audit('table.updated', $v['name']);

                return null;
            }
            if ($action === 'terminal.save') {
                $v = $r->validate(['id' => 'nullable|integer|exists:terminals,id', 'name' => 'required|string|max:80', 'identifier' => 'required|string|max:60', 'provider' => 'nullable|string|max:80', 'provider_id' => 'nullable|string|max:80', 'location' => 'nullable|string|max:80', 'notes' => 'nullable|string|max:300', 'active' => 'required|boolean']);
                Support::fail(DB::table('terminals')->where('identifier', $v['identifier'])->when(isset($v['id']), fn ($q) => $q->where('id', '!=', $v['id']))->exists(), 'Terminal identifier already exists.');
                $id = $v['id'] ?? null;
                unset($v['id']);
                $this->save('terminals', $id, $v);
                Support::audit('terminal.updated', $v['name']);

                return null;
            }
            if ($action === 'promotion.save') {
                $v = $r->validate(['id' => 'nullable|integer|exists:promotions,id', 'name' => 'required|string|max:80', 'code' => 'nullable|string|max:40', 'type' => 'required|in:percent,fixed', 'value' => 'required', 'active' => 'required|boolean', 'starts_at' => 'nullable|date', 'ends_at' => 'nullable|date|after:starts_at', 'usage_limit' => 'nullable|integer|min:1']);
                $value = Money::cents($v['value']);
                Support::fail($v['type'] === 'percent' && $value > 10000, 'Percentage cannot exceed 100.');
                $v['value'] = $value;
                $v['code'] = empty($v['code']) ? null : strtoupper(trim($v['code']));
                Support::fail($v['code'] && DB::table('promotions')->where('code', $v['code'])->when(isset($v['id']), fn ($q) => $q->where('id', '!=', $v['id']))->exists(), 'Promo code already exists.');
                $tz = Support::settings()['timezone'] ?? 'America/Toronto';
                foreach (['starts_at', 'ends_at'] as $f) {
                    $v[$f] = empty($v[$f]) ? null : CarbonImmutable::parse($v[$f], $tz)->utc();
                }$id = $v['id'] ?? null;
                unset($v['id']);
                $this->save('promotions', $id, $v);
                Support::audit('promotion.updated', $v['name']);

                return null;
            }
            if ($action === 'settings.save') {
                $currencySettings = $r->validate([
                    'currency' => ['sometimes', 'required', Rule::in(Support::CURRENCIES)],
                    'cash_rounding_cents' => 'sometimes|required|integer|in:1,5,10,25,50,100',
                ]);
                $v = $r->validate(['business_name' => 'required|string|max:100', 'address' => 'nullable|string|max:200', 'phone' => 'nullable|string|max:40', 'timezone' => 'required|timezone', 'booking_minutes' => 'required|integer|min:15|max:600', 'tax_inclusive' => 'required|boolean', 'taxes' => 'present|array|max:4', 'taxes.*.name' => 'required|string|max:30', 'taxes.*.basis_points' => 'required|integer|min:0|max:3000', 'receipt_footer' => 'nullable|string|max:200', 'kitchen_pin' => 'nullable|digits_between:4,8', 'kitchen_output' => 'required|in:screen,printer,both']);
                $v = [...$v, ...$currencySettings];
                $v['kitchen_output'] = 'printer';
                if (isset($v['currency']) && $v['currency'] !== Support::settings()['currency'] && ! isset($v['cash_rounding_cents'])) {
                    $v['cash_rounding_cents'] = 1;
                }
                if (! empty($v['kitchen_pin'])) {
                    Pins::ensureUnique($v['kitchen_pin'], null, true);
                    DB::table('settings')->updateOrInsert(['name' => 'kitchen_pin_hash'], ['value' => json_encode(Hash::make($v['kitchen_pin'])), 'updated_at' => now()]);
                    DB::table('settings')->updateOrInsert(['name' => 'kitchen_version'], ['value' => json_encode(bin2hex(random_bytes(12))), 'updated_at' => now()]);
                }unset($v['kitchen_pin']);
                foreach ($v as $key => $value) {
                    DB::table('settings')->updateOrInsert(['name' => $key], ['value' => json_encode($value), 'updated_at' => now()]);
                }Support::audit('settings.updated', 'Business settings', ['fields' => array_keys($v)]);

                return null;
            }
            if ($action === 'reconciliation.save') {
                $v = $r->validate(['terminal_id' => 'required|integer|exists:terminals,id', 'actual' => 'required', 'notes' => 'nullable|string|max:300']);
                $day = Support::day();
                $expected = (new Reports)->terminalTotal($day->id, $v['terminal_id']);
                DB::table('reconciliations')->updateOrInsert(['business_day_id' => $day->id, 'terminal_id' => $v['terminal_id']], ['expected_cents' => $expected, 'actual_cents' => Money::signedCents($v['actual']), 'notes' => $v['notes'] ?? null, 'user_id' => Auth::id(), 'updated_at' => now(), 'created_at' => now()]);
                Support::audit('terminal.reconciled', "Terminal {$v['terminal_id']}", ['expected_cents' => $expected, 'actual_cents' => Money::signedCents($v['actual'])]);

                return null;
            }
            abort(404);
        }, 3);
    }

    private function save(string $table, ?int $id, array $data): void
    {
        if ($id) {
            DB::table($table)->where('id', $id)->update([...$data, 'updated_at' => now()]);
        } else {
            DB::table($table)->insert([...$data, 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private function reservation(string $action, Request $r): mixed
    {
        if ($action === 'reservation.status') {
            $v = $r->validate(['id' => 'required|integer|exists:reservations,id', 'status' => 'required|in:cancelled,no_show']);
            $reservation = DB::table('reservations')->find($v['id']);
            DB::table('dining_tables')->where('id', $reservation->dining_table_id)->lockForUpdate()->first();
            $reservation = DB::table('reservations')->where('id', $v['id'])->lockForUpdate()->first();
            Support::fail($reservation->status !== 'upcoming', 'Only upcoming reservations can be cancelled or marked no-show.');
            DB::table('reservations')->where('id', $v['id'])->update(['status' => $v['status'], 'updated_at' => now()]);
            Support::audit('reservation.'.$v['status'], "Reservation {$v['id']}");

            return null;
        }
        abort_unless(in_array($action, ['reservation.create', 'reservation.update']), 404);
        $v = $r->validate(['id' => 'nullable|integer|exists:reservations,id', 'name' => 'required|string|max:100', 'phone' => 'nullable|string|max:30', 'table_id' => 'required|integer|exists:dining_tables,id', 'guests' => 'required|integer|min:1|max:50', 'starts_at' => 'required|date', 'ends_at' => 'required|date|after:starts_at', 'notes' => 'nullable|string|max:300']);
        $old = $action === 'reservation.update' ? DB::table('reservations')->where('id', $v['id'] ?? 0)->lockForUpdate()->first() : null;
        Support::fail($action === 'reservation.update' && (! $old || $old->status !== 'upcoming'), 'Only upcoming bookings can be edited.');
        $tz = Support::settings()['timezone'] ?? 'America/Toronto';
        $start = CarbonImmutable::parse($v['starts_at'], $tz)->utc();
        $end = CarbonImmutable::parse($v['ends_at'], $tz)->utc();
        Support::fail($end->lte(now()), 'Booking must end in the future.');
        $t = DB::table('dining_tables')->where('id', $v['table_id'])->lockForUpdate()->first();
        Support::fail(! $t->active || $v['guests'] > $t->seats, 'Table is unavailable or too small.');
        Support::fail(DB::table('reservations')->where('dining_table_id', $t->id)->whereIn('status', ['upcoming', 'seated'])->where('starts_at', '<', $end)->where('ends_at', '>', $start)->when($old, fn ($q) => $q->where('id', '!=', $old->id))->exists(), 'This table already has a booking during that time.');
        Support::fail($start->lte(now()) && DB::table('orders')->where('dining_table_id', $t->id)->where('status', 'open')->exists(), 'This table is currently occupied.');
        $this->save('reservations', $old?->id, ['dining_table_id' => $t->id, 'name' => $v['name'], 'phone' => $v['phone'] ?? null, 'guests' => $v['guests'], 'starts_at' => $start, 'ends_at' => $end, 'notes' => $v['notes'] ?? null, 'created_by' => Auth::id(), 'created_at' => now(), 'updated_at' => now()]);
        Support::audit($old ? 'reservation.updated' : 'reservation.created', $v['name'], ['table' => $t->name, 'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String()]);

        return null;
    }
}
