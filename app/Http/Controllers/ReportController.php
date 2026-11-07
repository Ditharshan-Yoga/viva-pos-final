<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Reports;
use App\Services\Support;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    public function index(Request $request)
    {
        Support::manager();
        $v = $request->validate(['from' => 'required|date_format:Y-m-d', 'to' => 'required|date_format:Y-m-d|after_or_equal:from', 'format' => 'nullable|in:csv', 'department' => 'sometimes|in:all,restaurant,bar,legacy']);
        $tz = Support::settings()['timezone'];
        $from = CarbonImmutable::parse($v['from'], $tz)->startOfDay()->utc();
        $to = CarbonImmutable::parse($v['to'], $tz)->addDay()->startOfDay()->utc();
        Support::fail($from->diffInDays($to) > 367, 'Choose a period of at most one year.');
        $service = new Reports;
        $department = $v['department'] ?? 'all';
        $summary = $service->summary(null, null, $from, $to, $department);
        $cashiers = User::all(['id', 'name'])->map(fn ($u) => ['name' => $u->name, ...$service->summary(null, $u->id, $from, $to, $department)]);
        $products = DB::table('payments')->join('order_items', 'order_items.order_id', '=', 'payments.order_id')->where('payments.created_at', '>=', $from)->where('payments.created_at', '<', $to)->when($department !== 'all', fn ($q) => $q->where('order_items.department', $department))->selectRaw('order_items.name, SUM(quantity) as quantity, SUM(quantity * unit_cents) as sales_cents')->groupBy('order_items.name')->get()->keyBy('name');
        $returned = DB::table('refunds')->join('payments', 'payments.id', '=', 'refunds.payment_id')->join('order_items', 'order_items.order_id', '=', 'payments.order_id')->where('refunds.created_at', '>=', $from)->where('refunds.created_at', '<', $to)->when($department !== 'all', fn ($q) => $q->where('order_items.department', $department))->selectRaw('order_items.name, SUM(quantity) as quantity, SUM(quantity * unit_cents) as sales_cents')->groupBy('order_items.name')->get();
        foreach ($returned as $r) {
            $p = $products->get($r->name, (object) ['name' => $r->name, 'quantity' => 0, 'sales_cents' => 0]);
            $p->quantity -= $r->quantity;
            $p->sales_cents -= $r->sales_cents;
            $products->put($r->name, $p);
        }
        $promotions = DB::table('payments')->join('orders', 'orders.id', '=', 'payments.order_id')->where('payments.created_at', '>=', $from)->where('payments.created_at', '<', $to)->whereNotNull('promotion_name')->select('orders.id', 'promotion_name', 'discount_cents')->get()
            ->filter(fn ($p) => $department === 'all' || DB::table('order_items')->where('order_id', $p->id)->where('department', $department)->where('quantity', '>', 0)->exists())
            ->groupBy('promotion_name')->map(fn ($rows, $name) => ['name' => $name, 'uses' => $rows->count(), 'discount_cents' => $rows->sum(fn ($p) => $service->share($p->discount_cents, $p->id, $department))])->values();
        $terminals = DB::table('terminals')->get()->map(function ($t) use ($service, $from, $to, $department) {
            $s = $service->summary(null, null, $from, $to, $department, $t->id);

            return ['name' => $t->name, 'total_cents' => $s['card_cents']];
        });
        $reservations = DB::table('reservations')->join('dining_tables', 'dining_tables.id', '=', 'reservations.dining_table_id')->where('starts_at', '>=', $from)->where('starts_at', '<', $to)->when($department !== 'all', fn ($q) => $q->where('dining_tables.department', $department))->selectRaw('status, COUNT(*) as count')->groupBy('status')->get();
        $departments = collect(['restaurant', 'bar', 'legacy'])->mapWithKeys(fn ($d) => [$d => $service->summary(null, null, $from, $to, $d)]);
        $result = ['currency' => Support::settings()['currency'], 'department' => $department, 'departments' => $departments, 'from' => $v['from'], 'to' => $v['to'], 'summary' => $summary, 'cashiers' => $cashiers, 'products' => $products->values(), 'promotions' => $promotions, 'terminals' => $terminals, 'reservations' => $reservations];
        if (($v['format'] ?? '') === 'csv') {
            Support::audit('report.exported', 'Reports', ['from' => $v['from'], 'to' => $v['to']]);

            return response()->streamDownload(function () use ($result) {
                $out = fopen('php://output', 'w');
                $row = function (array $cells) use ($out) {
                    fputcsv($out, array_map(fn ($v) => is_string($v) && preg_match('/^[=+@\-\t\r]/', $v) ? "'".$v : $v, $cells), ',', '"', '');
                };
                $row(['Department', $result['department']]);
                $row(['Mixed bills: amounts allocated by item value; order counts can overlap. Legacy sales are unassigned.']);
                $row(['Amounts in integer '.$result['currency'].' minor units (100 = 1 '.$result['currency'].')', 'From', $result['from'], 'Through', $result['to']]);
                foreach ($result['summary'] as $key => $value) {
                    $row([$key, $value]);
                }
                foreach (['cashiers', 'products', 'promotions', 'terminals', 'reservations'] as $section) {
                    $row([]);
                    $row([$section]);
                    $first = true;
                    foreach ($result[$section] as $record) {
                        $a = (array) $record;
                        if ($first) {
                            $row(array_keys($a));
                            $first = false;
                        }$row(array_values($a));
                    }
                }
                fclose($out);
            }, 'pos-report-'.$v['from'].'-'.$v['to'].'.csv', ['Content-Type' => 'text/csv']);
        }

        return response()->json($result);
    }
}
