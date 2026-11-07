<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

class Orders
{
    public function run(string $action, Request $r): mixed
    {
        return DB::transaction(function () use ($action, $r) {
            $day = Support::day();
            if ($action === 'order.create') {
                $v = $r->validate(['key' => 'required|uuid', 'type' => 'required|in:dine_in,takeout,delivery', 'table_id' => 'nullable|integer|exists:dining_tables,id', 'reservation_id' => 'nullable|integer|exists:reservations,id', 'attended_by' => 'required|integer|exists:users,id', 'customer_name' => 'required_if:type,delivery|nullable|string|max:100', 'phone' => 'required_if:type,delivery|nullable|string|max:30', 'delivery_address' => 'required_if:type,delivery|nullable|string|max:500', 'delivery_fee' => 'nullable', 'notes' => 'nullable|string|max:500']);
                if ($existing = DB::table('orders')->where('request_key', $v['key'])->first()) {
                    return ['id' => $existing->id];
                }
                Support::fail(! User::whereKey($v['attended_by'])->where('active', true)->exists(), 'Select an active employee.');
                $table = null;
                if ($v['type'] === 'dine_in') {
                    $table = DB::table('dining_tables')->where('id', $v['table_id'] ?? 0)->where('active', true)->lockForUpdate()->first();
                    Support::fail(! $table, 'Select an available table.');
                    Support::fail(DB::table('orders')->where('dining_table_id', $table->id)->where('status', 'open')->exists(), 'This table already has an open order.');
                    $booking = DB::table('reservations')->where('dining_table_id', $table->id)->where('status', 'upcoming')->where('starts_at', '<=', now())->where('ends_at', '>', now())->first();
                    Support::fail($booking && (int) $booking->id !== (int) ($v['reservation_id'] ?? 0), 'This table is reserved now. Open its reservation to seat the customer.');
                    if (! empty($v['reservation_id'])) {
                        $booking = DB::table('reservations')->where('id', $v['reservation_id'])->lockForUpdate()->first();
                        Support::fail(! $booking || $booking->dining_table_id !== $table->id || $booking->status !== 'upcoming' || now()->lt($booking->starts_at) || now()->gte($booking->ends_at), 'Reservation cannot be seated.');
                        DB::table('reservations')->where('id', $booking->id)->update(['status' => 'seated', 'updated_at' => now()]);
                    }
                }
                $id = DB::table('orders')->insertGetId(['request_key' => $v['key'], 'business_day_id' => $day->id, 'dining_table_id' => $table?->id, 'reservation_id' => $table ? ($v['reservation_id'] ?? null) : null, 'created_by' => Auth::id(), 'attended_by' => $v['attended_by'], 'type' => $v['type'], 'delivery_address' => $v['type'] === 'delivery' ? $v['delivery_address'] : null, 'delivery_fee_cents' => $v['type'] === 'delivery' ? Money::cents($v['delivery_fee'] ?? '0') : 0, 'customer_name' => $v['customer_name'] ?? null, 'phone' => $v['phone'] ?? null, 'notes' => $v['notes'] ?? null, 'tax_snapshot' => json_encode(['inclusive' => Support::settings()['tax_inclusive'] ?? false, 'lines' => Support::settings()['taxes'] ?? []]), 'created_at' => now(), 'updated_at' => now()]);
                $this->recalculate($id);
                Support::audit('order.created', "Order $id");

                return ['id' => $id];
            }
            $r->validate(['order_id' => 'required|integer|exists:orders,id']);
            $order = DB::table('orders')->where('id', $r->integer('order_id'))->lockForUpdate()->first();
            if ($action === 'order.refund') {
                return $this->refund($order, $r, $day);
            }
            if ($action === 'order.pay' && $order->status === 'paid') {
                $p = DB::table('payments')->where('order_id', $order->id)->first();
                Support::fail($p->request_key !== $r->input('key'), 'Order was already paid.');

                return ['id' => $order->id];
            }
            Support::fail($order->status !== 'open', 'This order is no longer open.');
            Support::fail($order->business_day_id !== $day->id, 'This order belongs to another business day.');
            $r->validate(['version' => 'required|integer']);
            Support::fail($order->version !== $r->integer('version'), 'Order changed on another device. Refresh and try again.');
            $ticketId = null;
            if ($action === 'order.add') {
                $v = $r->validate(['product_id' => 'required|integer|exists:products,id', 'quantity' => 'required|integer|min:1|max:99', 'variant' => 'nullable|string|max:100', 'modifiers' => 'array|max:20', 'modifiers.*' => 'string|max:100', 'notes' => 'nullable|string|max:300']);
                $p = DB::table('products')->where('id', $v['product_id'])->where('active', true)->first();
                Support::fail(! $p, 'This product is unavailable.');
                $price = in_array($order->type, ['takeout', 'delivery']) ? ($p->takeout_price_cents ?? $p->price_cents) : $p->price_cents;
                $configuration = [];
                $variants = json_decode($p->variants ?? '[]', true);
                if (count($variants)) {
                    $variant = collect($variants)->firstWhere('name', $v['variant'] ?? '');
                    Support::fail(! $variant, 'Select a valid variant.');
                    $price = $variant['price_cents'];
                    $configuration[] = $variant['name'];
                }
                foreach (array_unique($v['modifiers'] ?? []) as $name) {
                    $m = collect(Support::productExtras($p))->firstWhere('name', $name);
                    Support::fail(! $m, 'Invalid modifier.');
                    $price += $m['price_cents'];
                    $configuration[] = $name;
                }
                DB::table('order_items')->insert(['order_id' => $order->id, 'product_id' => $p->id, 'department' => $p->department, 'name' => $p->name, 'unit_cents' => $price, 'quantity' => $v['quantity'], 'kitchen' => $p->kitchen, 'configuration' => json_encode($configuration), 'notes' => $v['notes'] ?? null, 'created_at' => now(), 'updated_at' => now()]);
                Support::audit('item.added', "Order $order->id", ['product' => $p->name, 'quantity' => $v['quantity']]);
            } elseif ($action === 'order.notes') {
                $v = $r->validate(['notes' => 'nullable|string|max:500']);
                DB::table('orders')->where('id', $order->id)->update(['notes' => $v['notes'] ?? null]);
                Support::audit('order.notes_updated', "Order $order->id");
            } elseif ($action === 'order.amend') {
                $v = $r->validate(['item_id' => 'required|integer', 'quantity' => 'required|integer|min:1|max:99', 'notes' => 'nullable|string|max:300', 'reason' => 'required|string|min:3|max:300']);
                $item = DB::table('order_items')->where('order_id', $order->id)->where('id', $v['item_id'])->where('quantity', '>', 0)->first();
                Support::fail(! $item, 'Item is no longer available.');
                if ($item->kitchen && $item->sent_quantity > 0) {
                    $instructions = 'REPLACE previous '.$item->sent_quantity.' × '.$item->name.' with '.$v['quantity'].' ×. Previous notes: '.($item->notes ?: 'none').'. New notes: '.($v['notes'] ?? 'none').'. Reason: '.$v['reason'];
                    $ticketId = $this->ticket($order, 'amended', [['name' => $item->name, 'quantity' => $v['quantity'], 'configuration' => json_decode($item->configuration, true), 'notes' => $instructions]]);
                }
                DB::table('order_items')->where('id', $item->id)->update(['quantity' => $v['quantity'], 'notes' => $v['notes'] ?? null, 'sent_quantity' => $item->sent_quantity > 0 ? $v['quantity'] : 0, 'updated_at' => now()]);
                Support::audit('item.amended', "Order $order->id", ['item' => $item->name, 'old_quantity' => $item->quantity, 'quantity' => $v['quantity'], 'reason' => $v['reason']]);
            } elseif ($action === 'order.remove') {
                $v = $r->validate(['item_id' => 'required|integer', 'reason' => 'required|string|min:3|max:300']);
                $item = DB::table('order_items')->where('id', $v['item_id'])->where('order_id', $order->id)->first();
                Support::fail(! $item, 'Item not found.');
                if ($item->kitchen && $item->sent_quantity > 0) {
                    $ticketId = $this->ticket($order, 'cancelled', [['name' => $item->name, 'quantity' => $item->sent_quantity, 'notes' => $v['reason'], 'configuration' => json_decode($item->configuration, true)]]);
                }
                DB::table('order_items')->where('id', $item->id)->update(['quantity' => 0, 'sent_quantity' => 0, 'updated_at' => now()]);
                Support::audit('item.removed', "Order $order->id", ['item' => $item->name, 'reason' => $v['reason']]);
            } elseif ($action === 'order.send') {
                $items = DB::table('order_items')->where('order_id', $order->id)->where('kitchen', true)->whereColumn('quantity', '>', 'sent_quantity')->get();
                Support::fail($items->isEmpty(), 'No new food to send.');
                $ticketId = $this->ticket($order, 'new', $items->map(fn ($i) => ['name' => $i->name, 'quantity' => $i->quantity - $i->sent_quantity, 'notes' => $i->notes, 'configuration' => json_decode($i->configuration, true)])->all());
                foreach ($items as $i) {
                    DB::table('order_items')->where('id', $i->id)->update(['sent_quantity' => $i->quantity]);
                }Support::audit('kot.sent', "Order $order->id");
            } elseif ($action === 'order.promotion') {
                $r->validate(['promotion_id' => 'nullable|integer', 'code' => 'nullable|string|max:40']);
                $p = null;
                if ($r->filled('code')) {
                    $p = DB::table('promotions')->where('code', strtoupper(trim($r->input('code'))))->first();
                } elseif ($r->filled('promotion_id')) {
                    $p = DB::table('promotions')->where('id', $r->integer('promotion_id'))->whereNull('code')->first();
                }
                if ($r->filled('code') || $r->filled('promotion_id')) {
                    $this->validPromotion($p);
                }
                DB::table('orders')->where('id', $order->id)->update(['promotion_id' => $p?->id, 'promotion_name' => $p?->name, 'promotion_snapshot' => $p ? json_encode(['type' => $p->type, 'value' => $p->value]) : null]);
                Support::audit('promotion.applied', "Order $order->id", ['promotion' => $p?->name]);
            } elseif ($action === 'order.cancel') {
                $v = $r->validate(['reason' => 'required|string|min:3|max:300']);
                $sent = DB::table('order_items')->where('order_id', $order->id)->where('sent_quantity', '>', 0)->get();
                if ($sent->isNotEmpty()) {
                    $ticketId = $this->ticket($order, 'cancelled', $sent->map(fn ($i) => ['name' => $i->name, 'quantity' => $i->sent_quantity, 'notes' => $v['reason']])->all());
                }
                DB::table('orders')->where('id', $order->id)->update(['status' => 'cancelled', 'cancel_reason' => $v['reason']]);
                if ($order->reservation_id) {
                    DB::table('reservations')->where('id', $order->reservation_id)->update(['status' => 'completed']);
                }Support::audit('order.cancelled', "Order $order->id", $v);
            } elseif ($action === 'order.pay') {
                return $this->pay($order, $r);
            } else {
                abort(404);
            }
            $this->recalculate($order->id);
            DB::table('orders')->where('id', $order->id)->increment('version');

            return ['id' => $order->id, 'ticket_id' => $ticketId];
        }, 3);
    }

    private function validPromotion(?object $p): void
    {
        Support::fail(! $p || ! $p->active || ($p->starts_at && now()->lt($p->starts_at)) || ($p->ends_at && now()->gt($p->ends_at)) || ($p->usage_limit !== null && $p->uses >= $p->usage_limit), 'Promotion is invalid, expired or fully used.');
    }

    public function recalculate(int $id): object
    {
        $o = DB::table('orders')->find($id);
        $subtotal = (int) DB::table('order_items')->where('order_id', $id)->selectRaw('COALESCE(SUM(unit_cents * quantity), 0) AS amount')->value('amount');
        $p = $o->promotion_snapshot ? (object) json_decode($o->promotion_snapshot, true) : ($o->promotion_id ? DB::table('promotions')->find($o->promotion_id) : null);
        $snapshot = json_decode($o->tax_snapshot, true);
        $totals = Money::totals($subtotal + $o->delivery_fee_cents, $p, $snapshot['lines'] ?? [], $snapshot['inclusive'] ?? false);
        $totals['tax_snapshot'] = json_encode($totals['tax_snapshot']);
        DB::table('orders')->where('id', $id)->update([...$totals, 'updated_at' => now()]);

        return DB::table('orders')->find($id);
    }

    private function ticket(object $o, string $kind, array $items): int
    {
        $label = $o->dining_table_id ? DB::table('dining_tables')->where('id', $o->dining_table_id)->value('name') : ($o->type === 'delivery' ? 'Delivery' : 'Takeaway');

        return DB::table('kitchen_tickets')->insertGetId(['order_id' => $o->id, 'label' => $label, 'kind' => $kind, 'items' => json_encode($items), 'created_at' => now(), 'updated_at' => now()]);
    }

    private function pay(object $o, Request $r): array
    {
        $v = $r->validate(['key' => 'required|uuid', 'method' => 'required|in:cash,card', 'tip' => 'nullable', 'tendered' => 'nullable', 'terminal_id' => 'nullable|integer|exists:terminals,id', 'reference' => 'nullable|string|max:100', 'external_confirmed' => 'boolean']);
        Support::fail(! DB::table('order_items')->where('order_id', $o->id)->where('quantity', '>', 0)->exists(), 'Add at least one item.');
        if ($o->promotion_id) {
            $p = DB::table('promotions')->where('id', $o->promotion_id)->lockForUpdate()->first();
            $this->validPromotion($p);
            DB::table('promotions')->where('id', $p->id)->increment('uses');
        }
        $o = $this->recalculate($o->id);
        $tip = Money::cents($v['tip'] ?? '0');
        $increment = (int) Support::settings()['cash_rounding_cents'];
        $rounding = $v['method'] === 'cash' ? Money::roundRatio($o->total_cents, $increment) * $increment - $o->total_cents : 0;
        $amount = $o->total_cents + $rounding;
        $received = null;
        $change = 0;
        if ($v['method'] === 'card') {
            Support::fail(empty($v['reference']) || empty($v['terminal_id']) || ! $r->boolean('external_confirmed'), 'Confirm terminal approval and enter the terminal and reference.');
            Support::fail(! DB::table('terminals')->where('id', $v['terminal_id'])->where('active', true)->exists(), 'Choose an active terminal.');
        } else {
            $received = Money::cents($v['tendered'] ?? '0');
            Support::fail($received < $amount + $tip, 'Cash received is less than the bill plus tip.');
            $change = $received - $amount - $tip;
        }
        DB::table('payments')->insert(['request_key' => $v['key'], 'order_id' => $o->id, 'user_id' => Auth::id(), 'tip_owner_id' => $o->attended_by, 'method' => $v['method'], 'terminal_id' => $v['method'] === 'card' ? $v['terminal_id'] : null, 'reference' => $v['method'] === 'card' ? $v['reference'] : null, 'amount_cents' => $amount, 'tip_cents' => $tip, 'tendered_cents' => $received, 'change_cents' => $change, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('orders')->where('id', $o->id)->update(['status' => 'paid', 'rounding_cents' => $rounding, 'version' => $o->version + 1, 'updated_at' => now()]);
        if ($o->reservation_id) {
            DB::table('reservations')->where('id', $o->reservation_id)->update(['status' => 'completed', 'updated_at' => now()]);
        }Support::audit('payment.completed', "Order $o->id", ['method' => $v['method'], 'amount_cents' => $amount, 'tip_cents' => $tip, 'tip_owner_id' => $o->attended_by]);

        return ['id' => $o->id];
    }

    private function refund(object $o, Request $r, object $day): array
    {
        $v = $r->validate(['key' => 'required|uuid', 'reason' => 'required|string|min:3|max:300', 'approver_id' => 'required|integer', 'approval_pin' => 'required|string', 'reference' => 'nullable|string|max:100', 'external_confirmed' => 'boolean']);
        $p = DB::table('payments')->where('order_id', $o->id)->first();
        Support::fail(! $p, 'This order has no payment.');
        $old = DB::table('refunds')->where('payment_id', $p->id)->first();
        if ($old) {
            Support::fail($old->request_key !== $v['key'], 'Already refunded.');

            return ['id' => $o->id];
        }
        $limit = 'approval:'.Auth::id().':'.$r->ip();
        Support::fail(RateLimiter::tooManyAttempts($limit, 5), 'Too many approval attempts. Try again later.');
        RateLimiter::hit($limit, 300);
        $approver = User::whereKey($v['approver_id'])->where('active', true)->whereIn('role', ['admin', 'manager'])->first();
        Support::fail(! $approver || ! Hash::check($v['approval_pin'], $approver->pin_hash), 'Approval PIN is incorrect.');
        RateLimiter::clear($limit);
        Support::fail($p->method === 'card' && (! $r->boolean('external_confirmed') || empty($v['reference'])), 'Process the full refund on the terminal and enter its reference.');
        DB::table('refunds')->insert(['request_key' => $v['key'], 'payment_id' => $p->id, 'business_day_id' => $day->id, 'requested_by' => Auth::id(), 'approved_by' => $approver->id, 'reference' => $v['reference'] ?? null, 'reason' => $v['reason'], 'amount_cents' => $p->amount_cents + $p->tip_cents, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('orders')->where('id', $o->id)->update(['status' => 'refunded', 'updated_at' => now()]);
        Support::audit('refund.completed', "Order $o->id", ['approved_by' => $approver->id, 'reason' => $v['reason'], 'amount_cents' => $p->amount_cents + $p->tip_cents]);

        return ['id' => $o->id];
    }
}
