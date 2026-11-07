<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Reports;
use App\Services\Support;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class PosWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $manager;

    private User $cashier;

    private int $product;

    private int $table;

    private int $terminal;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->manager = User::factory()->create(['active' => true, 'role' => 'manager', 'employee_id' => 'M', 'pin_hash' => Hash::make('1234')]);
        $this->cashier = User::factory()->create(['active' => true, 'role' => 'cashier', 'employee_id' => 'C', 'pin_hash' => Hash::make('5678')]);
        $cat = DB::table('categories')->insertGetId(['name' => 'Food']);
        $this->product = DB::table('products')->insertGetId(['name' => 'Pizza', 'category_id' => $cat, 'price_cents' => 1000, 'kitchen' => true, 'variants' => '[]', 'modifiers' => '[]']);
        $this->table = DB::table('dining_tables')->insertGetId(['name' => 'Table 1', 'seats' => 4]);
        $this->terminal = DB::table('terminals')->insertGetId(['name' => 'Terminal', 'identifier' => 'T1']);
        $this->loginAs($this->manager);
    }

    private function loginAs(User $u): void
    {
        $id = (string) Str::uuid();
        DB::table('staff_sessions')->insert(['id' => $id, 'user_id' => $u->id, 'device' => 'Test', 'started_at' => now(), 'last_seen_at' => now()]);
        $this->actingAs($u)->withSession(['staff_session' => $id]);
    }

    private function action(string $a, array $v = [])
    {
        return $this->postJson('/api/actions/'.$a, $v);
    }

    private function openOrder(array $values = []): int
    {
        if (! DB::table('business_days')->where('status', 'open')->exists()) {
            $this->action('day.open')->assertOk();
        }

        return $this->action('order.create', ['key' => (string) Str::uuid(), 'type' => 'takeout', 'attended_by' => $this->cashier->id, ...$values])->assertOk()->json('result.id');
    }

    private function orderAction(int $id, string $action, array $v = [])
    {
        return $this->action($action, ['order_id' => $id, 'version' => DB::table('orders')->find($id)->version, ...$v]);
    }

    private function readyToPay(): int
    {
        $id = $this->openOrder();
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => []])->assertOk();
        $this->orderAction($id, 'order.send')->assertOk();

        return $id;
    }

    public function test_cashier_cannot_open_day_or_change_settings_or_view_reports(): void
    {
        $this->loginAs($this->cashier);
        $this->action('day.open')->assertForbidden();
        $this->action('settings.save')->assertForbidden();
        $this->getJson('/api/reports?from=2026-01-01&to=2026-01-02')->assertForbidden();
    }

    public function test_order_requires_open_day_and_stale_version_is_rejected(): void
    {
        $this->action('order.create')->assertUnprocessable();
        $id = $this->openOrder();
        $this->orderAction($id, 'order.add', ['version' => 0, 'product_id' => $this->product, 'quantity' => 1])->assertUnprocessable();
    }

    public function test_incremental_kitchen_tickets_and_cancellation_acknowledgement(): void
    {
        $id = $this->readyToPay();
        $this->orderAction($id, 'order.send')->assertUnprocessable();
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 2, 'modifiers' => []])->assertOk();
        $this->orderAction($id, 'order.send')->assertOk();
        $ticket = DB::table('kitchen_tickets')->latest('id')->first();
        $this->assertSame(2, json_decode($ticket->items, true)[0]['quantity']);
        $item = DB::table('order_items')->where('order_id', $id)->first();
        $this->orderAction($id, 'order.remove', ['item_id' => $item->id, 'reason' => 'Customer changed mind'])->assertOk();
        $cancel = DB::table('kitchen_tickets')->latest('id')->first();
        $this->assertSame('cancelled', $cancel->kind);
        $this->postJson('/api/kitchen/'.$cancel->id, ['status' => 'acknowledged'])->assertOk();
        $this->assertDatabaseHas('kitchen_tickets', ['id' => $cancel->id, 'acknowledged' => 1]);
    }

    public function test_food_can_be_paid_directly_with_optional_zero_tip_and_no_duplicate_payment(): void
    {
        $id = $this->openOrder();
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => []])->assertOk();
        $v = ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '10'];
        $this->orderAction($id, 'order.pay', $v)->assertOk();
        $this->orderAction($id, 'order.pay', $v)->assertOk();
        $this->assertDatabaseCount('payments', 1);
        $this->assertDatabaseCount('kitchen_tickets', 0);
        $this->assertDatabaseHas('payments', ['order_id' => $id, 'tip_cents' => 0]);
    }

    public function test_full_refund_requires_approval_and_reverses_tip_owner(): void
    {
        $id = $this->readyToPay();
        $this->loginAs($this->cashier);
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tip' => '2', 'tendered' => '12'])->assertOk();
        $v = ['key' => (string) Str::uuid(), 'reason' => 'Returned order', 'approver_id' => $this->manager->id, 'approval_pin' => '0000'];
        $this->orderAction($id, 'order.refund', $v)->assertUnprocessable();
        $v['approval_pin'] = '1234';
        $this->orderAction($id, 'order.refund', $v)->assertOk();
        $this->assertDatabaseHas('refunds', ['amount_cents' => 1200]);
        $this->assertSame(0, (new Reports)->summary(null, $this->cashier->id)['earned_tips_cents']);
    }

    public function test_card_requires_external_approval_and_reference(): void
    {
        $id = $this->readyToPay();
        $v = ['key' => (string) Str::uuid(), 'method' => 'card', 'terminal_id' => $this->terminal, 'tip' => '0'];
        $this->orderAction($id, 'order.pay', $v)->assertUnprocessable();
        $this->orderAction($id, 'order.pay', [...$v, 'external_confirmed' => true, 'reference' => 'AUTH-1'])->assertOk();
    }

    public function test_one_discount_replaces_another(): void
    {
        $id = $this->readyToPay();
        $first = DB::table('promotions')->insertGetId(['name' => '10%', 'type' => 'percent', 'value' => 1000]);
        $second = DB::table('promotions')->insertGetId(['name' => 'Two dollars', 'type' => 'fixed', 'value' => 200]);
        $this->orderAction($id, 'order.promotion', ['promotion_id' => $first])->assertOk();
        $this->orderAction($id, 'order.promotion', ['promotion_id' => $second])->assertOk();
        $this->assertDatabaseHas('orders', ['id' => $id, 'discount_cents' => 200, 'total_cents' => 800]);
    }

    public function test_bookings_reject_overlap_allow_adjacent_and_can_be_edited(): void
    {
        $v = ['name' => 'Guest', 'table_id' => $this->table, 'guests' => 2, 'starts_at' => now()->addDay()->toIso8601String(), 'ends_at' => now()->addDay()->addHour()->toIso8601String()];
        $this->action('reservation.create', $v)->assertOk();
        $this->action('reservation.create', $v)->assertUnprocessable();
        $this->action('reservation.create', [...$v, 'starts_at' => $v['ends_at'], 'ends_at' => now()->addDay()->addHours(2)->toIso8601String()])->assertOk();
        $id = DB::table('reservations')->min('id');
        $this->action('reservation.update', [...$v, 'id' => $id, 'name' => 'Updated'])->assertOk();
        $this->assertDatabaseHas('reservations', ['id' => $id, 'name' => 'Updated']);
    }

    public function test_reserved_table_blocks_walk_in_and_payment_releases_table(): void
    {
        $v = ['name' => 'Guest', 'table_id' => $this->table, 'guests' => 2, 'starts_at' => now()->subMinute()->toIso8601String(), 'ends_at' => now()->addHour()->toIso8601String()];
        $this->action('reservation.create', $v)->assertOk();
        $this->action('day.open')->assertOk();
        $this->action('order.create', ['key' => (string) Str::uuid(), 'type' => 'dine_in', 'table_id' => $this->table, 'attended_by' => $this->cashier->id])->assertUnprocessable();
        $id = $this->openOrder(['type' => 'dine_in', 'table_id' => $this->table, 'reservation_id' => DB::table('reservations')->value('id')]);
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => []])->assertOk();
        $this->orderAction($id, 'order.send')->assertOk();
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '10'])->assertOk();
        $this->openOrder(['type' => 'dine_in', 'table_id' => $this->table]);
    }

    public function test_available_tables_hide_conflicts_and_allow_adjacent_or_own_booking(): void
    {
        $start = now()->addDay()->startOfHour();
        $v = ['name' => 'Guest', 'table_id' => $this->table, 'guests' => 2, 'starts_at' => $start->toIso8601String(), 'ends_at' => $start->copy()->addHour()->toIso8601String()];
        $this->action('reservation.create', $v)->assertOk();
        $id = DB::table('reservations')->value('id');
        $query = ['starts_at' => $v['starts_at'], 'ends_at' => $v['ends_at'], 'guests' => 2];
        $get = fn ($q) => $this->getJson('/api/available-tables?'.http_build_query($q));
        $get($query)->assertOk()->assertJsonCount(0, 'tables');
        $get([...$query, 'id' => $id])->assertOk()->assertJsonPath('tables.0.id', $this->table);
        $get([...$query, 'starts_at' => $v['ends_at'], 'ends_at' => $start->copy()->addHours(2)->toIso8601String()])->assertOk()->assertJsonPath('tables.0.id', $this->table);
        $get([...$query, 'id' => $id, 'guests' => 5])->assertOk()->assertJsonCount(0, 'tables');
        $tz = Support::settings()['timezone'];
        $get([...$query, 'starts_at' => $start->copy()->timezone($tz)->format('Y-m-d\TH:i'), 'ends_at' => $start->copy()->addHour()->timezone($tz)->format('Y-m-d\TH:i')])->assertOk()->assertJsonCount(0, 'tables');
        $this->action('reservation.status', ['id' => $id, 'status' => 'cancelled'])->assertOk();
        $get($query)->assertOk()->assertJsonPath('tables.0.id', $this->table);
        DB::table('dining_tables')->where('id', $this->table)->update(['active' => false]);
        $get($query)->assertOk()->assertJsonCount(0, 'tables');
        $get([...$query, 'ends_at' => $query['starts_at']])->assertUnprocessable();
    }

    public function test_available_tables_hide_currently_occupied_tables(): void
    {
        $this->openOrder(['type' => 'dine_in', 'table_id' => $this->table]);
        $query = ['starts_at' => now()->subMinute()->toIso8601String(), 'ends_at' => now()->addHour()->toIso8601String(), 'guests' => 2];
        $this->getJson('/api/available-tables?'.http_build_query($query))->assertOk()->assertJsonCount(0, 'tables');
    }

    public function test_close_blocks_unpaid_orders_and_cashier_summary_then_reopen(): void
    {
        $id = $this->openOrder();
        $this->action('day.close')->assertUnprocessable();
        $this->orderAction($id, 'order.cancel', ['reason' => 'No longer needed'])->assertOk();
        $this->loginAs($this->cashier);
        $this->action('day.submit')->assertOk();
        $this->action('day.close')->assertForbidden();
        $this->loginAs($this->manager);
        $this->action('day.close')->assertOk();
        $day = DB::table('business_days')->first();
        $this->action('day.reopen', ['day_id' => $day->id, 'reason' => 'Correct terminal total'])->assertOk();
    }

    public function test_admin_cannot_create_admin_and_disabled_session_is_revoked(): void
    {
        $admin = User::factory()->create(['active' => true, 'role' => 'admin']);
        $this->loginAs($admin);
        $this->action('user.save', ['name' => 'Other admin', 'employee_id' => 'A2', 'role' => 'admin', 'pin' => '9876', 'active' => true])->assertForbidden();
        $this->loginAs($this->cashier);
        $this->cashier->forceFill(['active' => false])->save();
        $this->getJson('/api/state')->assertUnauthorized();
    }

    public function test_reports_export_and_settings_with_no_tax(): void
    {
        $s = Support::settings();
        $this->action('settings.save', $s)->assertOk();
        $id = $this->readyToPay();
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '10'])->assertOk();
        $date = now()->timezone($s['timezone'])->toDateString();
        $this->getJson('/api/reports?from='.$date.'&to='.$date)->assertOk()->assertJsonPath('summary.net_cents', 1000);
        $this->get('/api/reports?from='.$date.'&to='.$date.'&format=csv')->assertOk()->assertHeader('content-type', 'text/csv; charset=UTF-8');
    }

    public function test_currency_settings_apply_to_state_receipts_exports_and_cash_rounding(): void
    {
        $settings = Support::settings();
        $this->assertSame('CAD', $settings['currency']);
        $this->assertSame(5, $settings['cash_rounding_cents']);
        $settings['currency'] = 'LKR';
        $settings['cash_rounding_cents'] = 1;
        $this->action('settings.save', $settings)->assertOk();
        $this->getJson('/api/state')->assertOk()->assertJsonPath('settings.currency', 'LKR');
        DB::table('products')->where('id', $this->product)->update(['price_cents' => 1002]);
        $id = $this->readyToPay();
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '11'])->assertOk();
        $this->assertDatabaseHas('payments', ['order_id' => $id, 'amount_cents' => 1002, 'change_cents' => 98]);
        $this->get('/receipts/'.$id)->assertOk()->assertSee('LKR 10.02')->assertDontSee('CAD');
        $date = now()->timezone($settings['timezone'])->toDateString();
        $this->getJson('/api/reports?from='.$date.'&to='.$date)->assertOk()->assertJsonPath('currency', 'LKR')->assertJsonPath('summary.net_cents', 1002);
        $csv = $this->get('/api/reports?from='.$date.'&to='.$date.'&format=csv')->assertOk()->streamedContent();
        $this->assertStringContainsString('LKR minor units', $csv);
        $this->assertStringNotContainsString('CAD', $csv);

        $settings['cash_rounding_cents'] = 10;
        $this->action('settings.save', $settings)->assertOk();
        $id = $this->readyToPay();
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '11'])->assertOk();
        $this->assertDatabaseHas('payments', ['order_id' => $id, 'amount_cents' => 1000, 'change_cents' => 100]);
        $this->assertDatabaseHas('orders', ['id' => $id, 'rounding_cents' => -2]);
    }

    public function test_currency_settings_reject_unsupported_values_and_cashier_changes(): void
    {
        $settings = Support::settings();
        foreach (['XYZ', 'JPY', 'KWD', ''] as $currency) {
            $this->action('settings.save', [...$settings, 'currency' => $currency])->assertUnprocessable();
        }
        $this->action('settings.save', [...$settings, 'cash_rounding_cents' => 0])->assertUnprocessable();
        $this->assertSame('CAD', Support::settings()['currency']);
        $this->loginAs($this->cashier);
        $this->action('settings.save', [...$settings, 'currency' => 'USD'])->assertForbidden();
    }

    public function test_kitchen_session_cannot_read_financials(): void
    {
        Auth::logout();
        $this->withSession(['kitchen' => true, 'kitchen_version' => '1']);
        $this->getJson('/api/state')->assertUnauthorized();
        $this->postJson('/api/actions/day.open')->assertUnauthorized();
    }

    public function test_pin_only_login_routes_staff_and_kitchen_without_exposing_names(): void
    {
        Auth::logout();
        $this->post('/login', ['pin' => '5678'])->assertRedirect('/');
        $this->assertAuthenticatedAs($this->cashier);
        $this->post('/logout')->assertRedirect('/login');
        DB::table('settings')->where('name', 'kitchen_pin_hash')->update(['value' => json_encode(Hash::make('7259'))]);
        $this->postJson('/login', ['pin' => '7259'])->assertUnprocessable();
        $this->assertGuest();
        $this->getJson('/api/state')->assertUnauthorized();
    }

    public function test_duplicate_employee_and_kitchen_pins_are_rejected(): void
    {
        $v = ['name' => 'New colleague', 'employee_id' => 'NEW', 'role' => 'cashier', 'pin' => '1234', 'active' => true];
        $this->action('user.save', $v)->assertUnprocessable();
        $s = Support::settings();
        $this->action('settings.save', [...$s, 'kitchen_pin' => '5678'])->assertUnprocessable();
        $this->action('settings.save', [...$s, 'kitchen_pin' => '7259'])->assertOk();
        $this->action('user.save', [...$v, 'pin' => '7259'])->assertUnprocessable();
        $this->action('user.save', [...$v, 'pin' => '9876'])->assertOk();
    }

    public function test_print_output_modes_and_separate_customer_receipt(): void
    {
        $id = $this->readyToPay();
        $ticket = DB::table('kitchen_tickets')->first();
        $this->get('/kitchen-tickets/'.$ticket->id.'/print')->assertOk();
        $s = Support::settings();
        $this->action('settings.save', [...$s, 'kitchen_output' => 'both'])->assertOk();
        $this->getJson('/api/state')->assertJsonPath('settings.kitchen_output', 'printer');
        $this->get('/kitchen')->assertRedirect('/');
        $this->get('/kitchen-tickets/'.$ticket->id.'/print')->assertOk()->assertSee('KITCHEN ORDER')->assertSee('Pizza')->assertDontSee('$10.00');
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '10'])->assertOk();
        $this->get('/receipts/'.$id)->assertOk()->assertSee('Total paid')->assertSee('$10.00');
        $this->action('settings.save', [...$s, 'kitchen_output' => 'printer'])->assertOk();
        $this->postJson('/api/kitchen/'.$ticket->id, ['status' => 'completed'])->assertOk();
    }

    public function test_amendment_notifies_kitchen_and_preserves_discount_snapshot(): void
    {
        $id = $this->readyToPay();
        $item = DB::table('order_items')->where('order_id', $id)->first();
        $this->orderAction($id, 'order.amend', ['item_id' => $item->id, 'quantity' => 2, 'notes' => 'No onions', 'reason' => 'Customer request'])->assertOk();
        $this->assertDatabaseHas('kitchen_tickets', ['kind' => 'amended']);
        $this->assertDatabaseHas('order_items', ['id' => $item->id, 'quantity' => 2, 'sent_quantity' => 2]);
        $promotion = DB::table('promotions')->insertGetId(['name' => 'Ten percent', 'type' => 'percent', 'value' => 1000]);
        $this->orderAction($id, 'order.promotion', ['promotion_id' => $promotion])->assertOk();
        DB::table('promotions')->where('id', $promotion)->update(['value' => 2000]);
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '18'])->assertOk();
        $this->assertDatabaseHas('payments', ['order_id' => $id, 'amount_cents' => 1800]);
    }

    public function test_history_is_paginated_and_inactivity_is_preserved(): void
    {
        $this->openOrder(['customer_name' => 'History guest']);
        $this->getJson('/api/orders?q=History&status=open')->assertOk()->assertJsonPath('total', 1);
        $session = DB::table('staff_sessions')->where('user_id', $this->manager->id)->first();
        DB::table('staff_sessions')->where('id', $session->id)->update(['last_seen_at' => now()->subMinutes(5)]);
        $this->getJson('/api/state')->assertOk();
        $this->assertDatabaseHas('staff_sessions', ['id' => $session->id, 'end_reason' => 'inactivity_detected']);
    }

    public function test_department_totals_are_exact_and_historical_after_refund(): void
    {
        foreach ([false, true] as $inclusive) {
            DB::table('settings')->where('name', 'tax_inclusive')->update(['value' => json_encode($inclusive)]);
            DB::table('settings')->where('name', 'taxes')->update(['value' => json_encode([['name' => 'VAT', 'basis_points' => 1300]])]);
            $id = $this->openOrder();
            DB::table('products')->where('id', $this->product)->update(['department' => 'restaurant', 'price_cents' => 1001]);
            $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1])->assertOk();
            DB::table('products')->where('id', $this->product)->update(['department' => 'bar', 'price_cents' => 503]);
            $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1])->assertOk();
            $promo = DB::table('promotions')->insertGetId(['name' => 'Odd discount', 'type' => 'fixed', 'value' => 101]);
            $this->orderAction($id, 'order.promotion', ['promotion_id' => $promo])->assertOk();
            $this->orderAction($id, 'order.send')->assertOk();
            $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tip' => '1.03', 'tendered' => '30'])->assertOk();
            DB::table('products')->where('id', $this->product)->update(['department' => 'restaurant', 'price_cents' => 9999]);
            $this->assertDatabaseHas('order_items', ['order_id' => $id, 'department' => 'bar', 'unit_cents' => 503]);
            $r = new Reports;
            $all = $r->summary();
            $food = $r->summary(department: 'restaurant');
            $bar = $r->summary(department: 'bar');
            foreach ([$all, $food, $bar] as $departmentSummary) {
                $this->assertSame($departmentSummary['cash_cents'], $departmentSummary['net_cents'] + $departmentSummary['tax_cents'] + $departmentSummary['rounding_cents'] + $departmentSummary['tips_cents']);
            }
            foreach ($all as $metric => $value) {
                if (str_ends_with($metric, '_cents')) {
                    $this->assertSame($value, $food[$metric] + $bar[$metric], $metric);
                }
            }
            $date = now()->timezone(Support::settings()['timezone'])->toDateString();
            $this->getJson('/api/reports?from='.$date.'&to='.$date.'&department=bar')->assertOk()->assertJsonPath('summary.net_cents', $bar['net_cents'])->assertJsonPath('department', 'bar');
            $this->orderAction($id, 'order.refund', ['key' => (string) Str::uuid(), 'reason' => 'Full return', 'approver_id' => $this->manager->id, 'approval_pin' => '1234'])->assertOk();
            foreach (['all', 'restaurant', 'bar'] as $d) {
                $summary = (new Reports)->summary(department: $d);
                foreach (['net_cents', 'tax_cents', 'tips_cents', 'earned_tips_cents', 'rounding_cents', 'cash_cents'] as $metric) {
                    $this->assertSame(0, $summary[$metric], $d.' '.$metric);
                }
            }
        }
    }

    public function test_shared_extras_takeaway_prices_and_photo_validation(): void
    {
        $this->action('extras.save', ['name' => 'Pizza extras', 'modifiers' => [['name' => 'Olives', 'price_cents' => 125]]])->assertOk();
        $group = DB::table('extra_groups')->value('id');
        $payload = ['id' => $this->product, 'name' => 'Pizza', 'category_id' => DB::table('products')->find($this->product)->category_id, 'price' => '10', 'takeout_price' => '9', 'department' => 'restaurant', 'extra_group_id' => $group, 'kitchen' => true, 'active' => true, 'photo' => 'data:image/svg+xml;base64,PHN2Zz4='];
        $this->action('product.save', $payload)->assertUnprocessable();
        $payload['photo'] = null;
        $this->action('product.save', $payload)->assertOk();
        $id = $this->openOrder();
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => ['Olives']])->assertOk();
        $this->assertDatabaseHas('order_items', ['order_id' => $id, 'department' => 'restaurant', 'unit_cents' => 1025]);
        $this->action('extras.save', ['id' => $group, 'name' => 'Pizza extras', 'modifiers' => [['name' => 'Olives', 'price_cents' => 200]]])->assertOk();
        $this->assertDatabaseHas('order_items', ['order_id' => $id, 'unit_cents' => 1025]);
        $this->action('extras.delete', ['id' => $group])->assertUnprocessable();
        $this->assertDatabaseHas('extra_groups', ['id' => $group]);
        $this->loginAs($this->cashier);
        $this->action('extras.delete', ['id' => $group])->assertForbidden();
        $this->loginAs($this->manager);
        $this->action('product.save', [...$payload, 'extra_group_id' => null])->assertOk();
        $this->action('extras.delete', ['id' => $group])->assertOk();
        $this->assertDatabaseMissing('extra_groups', ['id' => $group]);
        $this->assertDatabaseHas('audit_events', ['action' => 'extras.deleted']);
        $this->assertDatabaseHas('order_items', ['order_id' => $id, 'unit_cents' => 1025]);
        $this->action('extras.delete', ['id' => $group])->assertUnprocessable();
        $this->getJson('/api/state')->assertOk();
        $this->loginAs($this->cashier);
        $this->action('extras.save', ['name' => 'Unauthorized', 'modifiers' => []])->assertForbidden();
    }

    public function test_delivery_fee_notes_payment_and_refund(): void
    {
        $id = $this->openOrder(['type' => 'delivery', 'customer_name' => 'Customer', 'phone' => '0771234567', 'delivery_address' => '12 Main Street', 'delivery_fee' => '2.50']);
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => []])->assertOk();
        $this->orderAction($id, 'order.notes', ['notes' => 'Call on arrival'])->assertOk();
        $this->assertDatabaseHas('orders', ['id' => $id, 'notes' => 'Call on arrival']);
        $this->orderAction($id, 'order.send')->assertOk();
        $this->assertDatabaseHas('kitchen_tickets', ['order_id' => $id, 'label' => 'Delivery']);
        $this->orderAction($id, 'order.pay', ['key' => (string) Str::uuid(), 'method' => 'cash', 'tendered' => '15'])->assertOk();
        $this->assertDatabaseHas('payments', ['order_id' => $id, 'amount_cents' => 1250, 'change_cents' => 250]);
        $this->get('/receipts/'.$id)->assertOk()->assertSee('12 Main Street')->assertSee('Delivery fee')->assertSee('$12.50');
        $this->assertSame(1, (new Reports)->summary()['delivery']);
        $this->assertSame(1250, (new Reports)->summary()['net_cents']);
        $this->orderAction($id, 'order.refund', ['key' => (string) Str::uuid(), 'approver_id' => $this->manager->id, 'approval_pin' => '1234', 'reason' => 'Delivery cancelled'])->assertOk();
        $this->assertSame(0, (new Reports)->summary()['net_cents']);
    }

    public function test_multiple_lists_and_bar_without_extras(): void
    {
        foreach (['Cheese', 'Olives'] as $name) {
            $this->action('extras.save', ['name' => $name, 'modifiers' => [['name' => $name, 'price_cents' => 100]]])->assertOk();
        }
        $ids = DB::table('extra_groups')->pluck('id')->all();
        $payload = ['id' => $this->product, 'name' => 'Pizza', 'category_id' => DB::table('products')->find($this->product)->category_id, 'price' => '10', 'department' => 'restaurant', 'extra_group_ids' => $ids, 'kitchen' => true, 'active' => true];
        $this->action('product.save', $payload)->assertOk();
        $this->action('extras.delete', ['id' => $ids[1]])->assertUnprocessable();
        $id = $this->openOrder();
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => ['Cheese', 'Olives']])->assertOk();
        $this->assertDatabaseHas('order_items', ['order_id' => $id, 'unit_cents' => 1200]);
        $this->action('product.save', [...$payload, 'department' => 'bar'])->assertOk();
        $this->orderAction($id, 'order.add', ['product_id' => $this->product, 'quantity' => 1, 'modifiers' => ['Cheese']])->assertUnprocessable();
        $this->getJson('/api/state')->assertOk()->assertJsonPath('products.0.modifiers', []);
    }

    public function test_string_extras_ids_are_normalized_and_legacy_links_cannot_be_deleted(): void
    {
        $ids = [];
        foreach (['First extras', 'Second extras'] as $name) {
            $ids[] = DB::table('extra_groups')->insertGetId(['name' => $name, 'modifiers' => '[]']);
        }
        $payload = ['id' => $this->product, 'name' => 'Pizza', 'category_id' => DB::table('products')->find($this->product)->category_id, 'price' => '10', 'department' => 'restaurant', 'extra_group_ids' => array_map('strval', $ids), 'kitchen' => true, 'active' => true];
        $this->action('product.save', $payload)->assertOk();
        $this->assertSame($ids, json_decode(DB::table('products')->find($this->product)->extra_group_ids, true));
        $this->action('extras.delete', ['id' => (string) $ids[1]])->assertUnprocessable();

        // Simulate a link stored by the older API, including a secondary list.
        DB::table('products')->where('id', $this->product)->update(['extra_group_ids' => json_encode(array_map('strval', $ids))]);
        $this->action('extras.delete', ['id' => $ids[1]])->assertUnprocessable();
        $products = $this->getJson('/api/state')->assertOk()->json('products');
        $product = collect($products)->firstWhere('id', $this->product);
        $this->assertSame($ids, $product['extra_group_ids']);
        $this->action('product.save', [...$payload, 'extra_group_ids' => []])->assertOk();
        $this->action('extras.delete', ['id' => $ids[1]])->assertOk();
        $this->assertDatabaseMissing('extra_groups', ['id' => $ids[1]]);
    }
}
