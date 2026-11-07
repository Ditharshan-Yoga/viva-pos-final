<?php

namespace App\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class Support
{
    public const CURRENCIES = ['CAD', 'LKR', 'USD', 'EUR', 'GBP', 'AUD', 'NZD', 'INR', 'AED', 'SAR', 'SGD', 'MYR', 'THB', 'PHP', 'ZAR', 'CHF'];

    public static function settings(): array
    {
        return array_replace(['currency' => 'CAD', 'cash_rounding_cents' => 5], DB::table('settings')->get()->mapWithKeys(fn ($r) => [$r->name => json_decode($r->value, true)])->all(), ['kitchen_output' => 'printer']);
    }

    public static function audit(string $action, string $subject = '', array $details = []): void
    {
        DB::table('audit_events')->insert(['user_id' => Auth::id(), 'actor' => Auth::user()?->name ?? 'Kitchen', 'action' => $action, 'subject' => $subject, 'details' => json_encode($details), 'created_at' => now()]);
    }

    public static function productExtras(object $product): array
    {
        if ($product->department === 'bar') {
            return [];
        }
        $ids = is_array($product->extra_group_ids) ? $product->extra_group_ids : json_decode($product->extra_group_ids ?? 'null', true);
        $ids ??= $product->extra_group_id ? [$product->extra_group_id] : [];
        $own = is_array($product->modifiers) ? $product->modifiers : json_decode($product->modifiers ?? '[]', true);
        $groups = DB::table('extra_groups')->whereIn('id', $ids)->get()->keyBy('id');
        foreach ($ids as $id) {
            $own = array_merge($own, json_decode($groups->get($id)?->modifiers ?? '[]', true));
        }

        return collect($own)->unique('name')->values()->all();
    }

    public static function fail(bool $condition, string $message): void
    {
        if ($condition) {
            throw ValidationException::withMessages(['operation' => $message]);
        }
    }

    public static function manager(): void
    {
        abort_unless(in_array(Auth::user()?->role, ['manager', 'admin']), 403);
    }

    public static function day(): object
    {
        $d = DB::table('business_days')->where('status', 'open')->lockForUpdate()->first();
        self::fail(! $d, 'Manager or Admin must start the business day first.');

        return $d;
    }

    public static function jsonRows(string $table, array $fields = []): Collection
    {
        return DB::table($table)->get()->map(function ($r) use ($fields) {
            foreach ($fields as $f) {
                $r->$f = json_decode($r->$f ?? 'null', true);
            }

            return $r;
        });
    }
}
