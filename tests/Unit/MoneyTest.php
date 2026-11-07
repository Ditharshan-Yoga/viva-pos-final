<?php

namespace Tests\Unit;

use App\Services\Money;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class MoneyTest extends TestCase
{
    public function test_small_tax_shares_stay_nonnegative_and_add_up_to_total(): void
    {
        foreach ([false, true] as $inclusive) {
            foreach ([[100, 100, 100, 100], [0, 100, 700, 200, 0], [0, 0], []] as $rates) {
                $taxes = array_map(fn ($rate) => ['name' => 'Tax', 'basis_points' => $rate], $rates);
                foreach ([0, 1, 13, 50, 99, 12345] as $subtotal) {
                    $r = Money::totals($subtotal, null, $taxes, $inclusive);
                    $lines = $r['tax_snapshot']['lines'];
                    $this->assertSame($r['tax_cents'], array_sum(array_column($lines, 'amount_cents')));
                    foreach ($lines as $line) {
                        $this->assertGreaterThanOrEqual(0, $line['amount_cents']);
                        if ($line['basis_points'] === 0) {
                            $this->assertSame(0, $line['amount_cents']);
                        }
                    }
                }
            }
        }
        $r = Money::totals(50, null, array_fill(0, 4, ['name' => 'Tax', 'basis_points' => 100]), false);
        $this->assertSame(2, $r['tax_cents']);
        $this->assertSame(52, $r['total_cents']);
    }

    public function test_money_is_exact_and_zero_tips_are_allowed(): void
    {
        $this->assertSame(0, Money::cents('0'));
        $this->assertSame(1999, Money::cents('19.99'));
    }

    public function test_invalid_precision_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        Money::cents('1.999');
    }

    public function test_discount_then_exclusive_tax(): void
    {
        $r = Money::totals(2000, (object) ['type' => 'percent', 'value' => 1000], [['name' => 'Tax', 'basis_points' => 1300]], false);
        $this->assertSame(200, $r['discount_cents']);
        $this->assertSame(234, $r['tax_cents']);
        $this->assertSame(2034, $r['total_cents']);
    }

    public function test_inclusive_tax_is_extracted_after_discount(): void
    {
        $r = Money::totals(2260, (object) ['type' => 'fixed', 'value' => 1130], [['name' => 'Tax', 'basis_points' => 1300]], true);
        $this->assertSame(130, $r['tax_cents']);
        $this->assertSame(1130, $r['total_cents']);
    }
}
