<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

class Reports
{
    private array $weights = [];

    /** Split each monetary component using cumulative cent rounding; all departments sum exactly to the original. */
    public function share(int $amount, int $orderId, string $department): int
    {
        if ($department === 'all') {
            return $amount;
        }
        if (! isset($this->weights[$orderId])) {
            $rows = DB::table('order_items')->where('order_id', $orderId)->where('quantity', '>', 0)->get();
            $weights = ['restaurant' => 0, 'bar' => 0, 'legacy' => 0];
            foreach ($rows as $item) {
                $weights[$item->department] += $item->unit_cents * $item->quantity;
            }
            if (! array_sum($weights)) {
                foreach ($rows as $item) {
                    $weights[$item->department] += $item->quantity;
                }
            }
            if (! array_sum($weights)) {
                $weights['legacy'] = 1;
            }
            $this->weights[$orderId] = $weights;
        }
        $weights = $this->weights[$orderId];
        $before = 0;
        $total = array_sum($weights);
        foreach ($weights as $name => $weight) {
            if ($name === $department) {
                $allocated = Money::roundRatio(abs($amount) * ($before + $weight), $total) - Money::roundRatio(abs($amount) * $before, $total);

                return $amount < 0 ? -$allocated : $allocated;
            }
            $before += $weight;
        }

        return 0;
    }

    public function summary(?int $dayId = null, ?int $userId = null, ?string $from = null, ?string $to = null, string $department = 'all', ?int $terminal = null): array
    {
        $payments = DB::table('payments')->join('orders', 'orders.id', '=', 'payments.order_id')
            ->when($dayId, fn ($q) => $q->where('orders.business_day_id', $dayId))
            ->when($from, fn ($q) => $q->where('payments.created_at', '>=', $from))->when($to, fn ($q) => $q->where('payments.created_at', '<', $to))
            ->when($terminal, fn ($q) => $q->where('payments.terminal_id', $terminal))
            ->select('payments.*', 'orders.subtotal_cents', 'orders.discount_cents', 'orders.tax_cents', 'orders.tax_snapshot', 'orders.rounding_cents', 'orders.type')->get();
        $refunds = DB::table('refunds')->join('payments', 'payments.id', '=', 'refunds.payment_id')->join('orders', 'orders.id', '=', 'payments.order_id')
            ->when($dayId, fn ($q) => $q->where('refunds.business_day_id', $dayId))
            ->when($from, fn ($q) => $q->where('refunds.created_at', '>=', $from))->when($to, fn ($q) => $q->where('refunds.created_at', '<', $to))
            ->when($terminal, fn ($q) => $q->where('payments.terminal_id', $terminal))
            ->select('payments.*', 'orders.subtotal_cents', 'orders.discount_cents', 'orders.tax_cents', 'orders.tax_snapshot', 'orders.rounding_cents', 'refunds.requested_by', 'refunds.amount_cents as refunded_cents')->get();
        $s = array_fill_keys(['orders', 'dine_in', 'takeout', 'delivery', 'gross_cents', 'discount_cents', 'net_cents', 'tax_cents', 'tips_cents', 'earned_tips_cents', 'rounding_cents', 'cash_cents', 'card_cents', 'refund_cents'], 0);
        foreach ($payments as $p) {
            $part = fn (int $amount) => $this->share($amount, $p->order_id, $department);
            if (! $userId || $p->tip_owner_id == $userId) {
                $s['earned_tips_cents'] += $part($p->tip_cents);
            }
            if ($userId && $p->user_id != $userId) {
                continue;
            }
            $included = $department === 'all' || DB::table('order_items')->where('order_id', $p->order_id)->where('department', $department)->where('quantity', '>', 0)->exists();
            if (! $included) {
                continue;
            }
            $snapshot = json_decode($p->tax_snapshot, true);
            $inclusive = $snapshot['inclusive'] ?? false;
            $rate = array_sum(array_column($snapshot['lines'] ?? [], 'basis_points'));
            $originalTax = $inclusive ? Money::roundRatio($p->subtotal_cents * $rate, 10000 + $rate) : 0;
            $gross = $part($p->subtotal_cents - $originalTax);
            $discount = $part($p->discount_cents - ($inclusive ? $originalTax - $p->tax_cents : 0));
            $s['gross_cents'] += $gross;
            $s['discount_cents'] += $discount;
            $s['net_cents'] += $gross - $discount;
            $s['tax_cents'] += $part($p->tax_cents);
            $s['tips_cents'] += $part($p->tip_cents);
            $s['rounding_cents'] += $part($p->rounding_cents);
            $s[$p->method.'_cents'] += $gross - $discount + $part($p->tax_cents) + $part($p->rounding_cents) + $part($p->tip_cents);
            $s['orders']++;
            $s[$p->type]++;
        }
        foreach ($refunds as $p) {
            $part = fn (int $amount) => $this->share($amount, $p->order_id, $department);
            if (! $userId || $p->tip_owner_id == $userId) {
                $s['earned_tips_cents'] -= $part($p->tip_cents);
            }
            if ($userId && $p->requested_by != $userId) {
                continue;
            }
            $snapshot = json_decode($p->tax_snapshot, true);
            $inclusive = $snapshot['inclusive'] ?? false;
            $rate = array_sum(array_column($snapshot['lines'] ?? [], 'basis_points'));
            $originalTax = $inclusive ? Money::roundRatio($p->subtotal_cents * $rate, 10000 + $rate) : 0;
            $refundedNet = $part($p->subtotal_cents - $originalTax) - $part($p->discount_cents - ($inclusive ? $originalTax - $p->tax_cents : 0));
            $s['net_cents'] -= $refundedNet;
            $s['tax_cents'] -= $part($p->tax_cents);
            $s['tips_cents'] -= $part($p->tip_cents);
            $s['rounding_cents'] -= $part($p->rounding_cents);
            $refundedTotal = $refundedNet + $part($p->tax_cents) + $part($p->rounding_cents) + $part($p->tip_cents);
            $s['refund_cents'] += $refundedTotal;
            $s[$p->method.'_cents'] -= $refundedTotal;
        }

        return $s;
    }

    public function terminalTotal(int $day, int $terminal): int
    {
        $paid = DB::table('payments')->join('orders', 'orders.id', '=', 'payments.order_id')->where('orders.business_day_id', $day)->where('terminal_id', $terminal)->selectRaw('COALESCE(SUM(payments.amount_cents + tip_cents),0) as total')->value('total');
        $refund = DB::table('refunds')->join('payments', 'payments.id', '=', 'refunds.payment_id')->where('refunds.business_day_id', $day)->where('terminal_id', $terminal)->sum('refunds.amount_cents');

        return (int) $paid - (int) $refund;
    }
}
