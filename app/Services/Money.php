<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

final class Money
{
    public static function cents(mixed $value): int
    {
        $s = (string) $value;
        if (! preg_match('/^\d{1,7}(?:\.\d{1,2})?$/D', $s)) {
            throw ValidationException::withMessages(['amount' => 'Enter a positive amount with at most two decimal places.']);
        }
        [$whole,$fraction] = array_pad(explode('.', $s), 2, '');

        return (int) $whole * 100 + (int) str_pad($fraction, 2, '0');
    }

    public static function signedCents(mixed $value): int
    {
        $s = (string) $value;

        return str_starts_with($s, '-') ? -self::cents(substr($s, 1)) : self::cents($s);
    }

    public static function roundRatio(int $numerator, int $denominator): int
    {
        return intdiv($numerator + intdiv($denominator, 2), $denominator);
    }

    public static function totals(int $subtotal, ?object $promotion, array $taxes, bool $inclusive): array
    {
        $discount = $promotion ? ($promotion->type === 'percent' ? self::roundRatio($subtotal * $promotion->value, 10000) : $promotion->value) : 0;
        $discount = min($subtotal, $discount);
        $base = $subtotal - $discount;
        $rate = array_sum(array_column($taxes, 'basis_points'));
        $tax = $inclusive ? self::roundRatio($base * $rate, 10000 + $rate) : self::roundRatio($base * $rate, 10000);
        $lines = [];
        $allocated = 0;
        $cumulativeRate = 0;
        foreach ($taxes as $rule) {
            // Round cumulative shares so every line is nonnegative and their sum is exact.
            $cumulativeRate += $rule['basis_points'];
            $cumulativeTax = $rate ? self::roundRatio($tax * $cumulativeRate, $rate) : 0;
            $amount = $cumulativeTax - $allocated;
            $allocated = $cumulativeTax;
            $lines[] = [...$rule, 'amount_cents' => $amount];
        }

        return ['subtotal_cents' => $subtotal, 'discount_cents' => $discount, 'tax_cents' => $tax, 'total_cents' => $inclusive ? $base : $base + $tax, 'tax_snapshot' => ['inclusive' => $inclusive, 'lines' => $lines]];
    }
}
