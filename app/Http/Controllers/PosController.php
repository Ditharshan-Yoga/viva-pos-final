<?php

namespace App\Http\Controllers;

use App\Events\PosUpdated;
use App\Models\User;
use App\Services\Management;
use App\Services\Orders;
use App\Services\Reports;
use App\Services\Support;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

class PosController extends Controller
{
    public function page(Request $r)
    {
        return Inertia::render('Workspace', ['initial' => $this->data($r)]);
    }

    public function state(Request $r)
    {
        return response()->json($this->data($r));
    }

    public function action(Request $r, string $action)
    {
        abort_unless(Auth::check(), 403);
        $result = str_starts_with($action, 'order.') ? (new Orders)->run($action, $r) : (new Management)->run($action, $r);
        PosUpdated::dispatch();

        return response()->json(['ok' => true, 'result' => $result]);
    }

    public function availableTables(Request $r)
    {
        abort_unless(Auth::check(), 403);
        $v = $r->validate(['starts_at' => 'required|date', 'ends_at' => 'required|date|after:starts_at', 'guests' => 'required|integer|min:1|max:50', 'id' => 'nullable|integer|exists:reservations,id']);
        $tz = Support::settings()['timezone'] ?? 'America/Toronto';
        $start = CarbonImmutable::parse($v['starts_at'], $tz)->utc();
        $end = CarbonImmutable::parse($v['ends_at'], $tz)->utc();
        Support::fail($end->lte(now()), 'Booking must end in the future.');
        $conflicts = DB::table('reservations')->whereIn('status', ['upcoming', 'seated'])
            ->where('starts_at', '<', $end)->where('ends_at', '>', $start)
            ->when(! empty($v['id']), fn ($q) => $q->where('id', '!=', $v['id']))->select('dining_table_id');
        $tables = DB::table('dining_tables')->where('active', true)->where('seats', '>=', $v['guests'])->whereNotIn('id', $conflicts)
            ->when($start->lte(now()), fn ($q) => $q->whereNotIn('id', DB::table('orders')->where('status', 'open')->whereNotNull('dining_table_id')->select('dining_table_id')))
            ->orderBy('name')->get(['id', 'name', 'seats', 'area']);

        return response()->json(['tables' => $tables])->header('Cache-Control', 'no-store');
    }

    public function kitchen(Request $r, int $id)
    {
        $v = $r->validate(['status' => 'required|in:preparing,ready,completed,acknowledged']);
        DB::transaction(function () use ($v, $id) {
            $ticket = DB::table('kitchen_tickets')->where('id', $id)->lockForUpdate()->first();
            abort_unless($ticket, 404);
            if ($v['status'] === 'acknowledged') {
                Support::fail($ticket->kind === 'new', 'This ticket does not need acknowledgement.');
                DB::table('kitchen_tickets')->where('id', $id)->update(['acknowledged' => true, 'status' => 'completed', 'updated_at' => now()]);
            } else {
                $next = ['new' => 'preparing', 'preparing' => 'ready', 'ready' => 'completed'];
                if ((Support::settings()['kitchen_output'] ?? 'screen') === 'printer' && $v['status'] === 'completed') {
                    $next[$ticket->status] = 'completed';
                }Support::fail($ticket->kind !== 'new' || ($next[$ticket->status] ?? null) !== $v['status'], 'Ticket status has changed. Refresh and try again.');
                DB::table('kitchen_tickets')->where('id', $id)->update(['status' => $v['status'], 'updated_at' => now()]);
            }Support::audit('kot.status_changed', "KOT $id", $v);
        });
        PosUpdated::dispatch();

        return response()->json(['ok' => true]);
    }

    public function kitchenPrint(Request $r, int $id)
    {
        $ticket = DB::table('kitchen_tickets')->find($id);
        abort_unless($ticket, 404);
        $settings = Support::settings();
        abort_unless(in_array($settings['kitchen_output'] ?? 'screen', ['printer', 'both']), 403);
        $order = DB::table('orders')->find($ticket->order_id);
        Support::audit('kot.print_viewed', "KOT $id");

        return view('kitchen-ticket', ['ticket' => $ticket, 'items' => json_decode($ticket->items, true), 'order' => $order, 'settings' => $settings]);
    }

    public function history(Request $r)
    {
        abort_unless(Auth::check(), 403);
        $v = $r->validate(['q' => 'nullable|string|max:100', 'status' => 'nullable|in:all,open,paid,refunded,cancelled', 'from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d|after_or_equal:from', 'page' => 'nullable|integer|min:1']);
        $tz = Support::settings()['timezone'];
        $query = DB::table('orders')->when(! empty($v['q']), fn ($q) => $q->where(fn ($q) => $q->where('id', ctype_digit($v['q']) ? $v['q'] : 0)->orWhere('customer_name', 'like', '%'.$v['q'].'%')))->when(! empty($v['status']) && $v['status'] !== 'all', fn ($q) => $q->where('status', $v['status']))->when(! empty($v['from']), fn ($q) => $q->where('created_at', '>=', CarbonImmutable::parse($v['from'], $tz)->startOfDay()->utc()))->when(! empty($v['to']), fn ($q) => $q->where('created_at', '<', CarbonImmutable::parse($v['to'], $tz)->addDay()->startOfDay()->utc()));
        $result = $query->latest('id')->paginate(30);
        $payments = DB::table('payments')->whereIn('order_id', collect($result->items())->pluck('id'))->get()->keyBy('order_id');
        foreach ($result->items() as $order) {
            $order->payment = $payments->get($order->id);
        }

        return response()->json($result);
    }

    public function receipt(Request $r, int $id)
    {
        abort_unless(Auth::check(), 403);
        $order = DB::table('orders')->find($id);
        abort_unless($order && in_array($order->status, ['paid', 'refunded']), 404);
        Support::audit('receipt.viewed', "Order $id");

        return view('receipt', ['order' => $order, 'items' => DB::table('order_items')->where('order_id', $id)->where('quantity', '>', 0)->get(), 'payment' => DB::table('payments')->where('order_id', $id)->first(), 'settings' => Support::settings()]);
    }

    private function data(Request $r): array
    {
        $s = Support::settings();
        unset($s['kitchen_pin_hash'],$s['kitchen_version']);
        $user = Auth::user();
        $manager = $user && in_array($user->role, ['manager', 'admin']);
        $tickets = DB::table('kitchen_tickets')->where(fn ($q) => $q->where('status', '!=', 'completed')->orWhere('updated_at', '>=', now()->subHours(12)))->latest()->limit(200)->get()->map(function ($t) {
            $t->items = json_decode($t->items, true);

            return $t;
        });
        $base = ['user' => $user?->only(['id', 'name', 'role', 'employee_id']), 'settings' => $s, 'tickets' => $tickets, 'server_time' => now()->toIso8601String(), 'kitchen_only' => ! $user];
        if (! $user) {
            return $base;
        }
        $day = DB::table('business_days')->latest('id')->first();
        $orders = DB::table('orders')->where('status', 'open')->get()->concat(DB::table('orders')->where('status', '!=', 'open')->where('updated_at', '>=', now()->subDays(7))->latest()->limit(300)->get())->sortByDesc('id')->values();
        $items = DB::table('order_items')->whereIn('order_id', $orders->pluck('id'))->get()->map(function ($i) {
            $i->configuration = json_decode($i->configuration, true);

            return $i;
        });
        foreach ($orders as $o) {
            $o->items = $items->where('order_id', $o->id)->values();
            $o->tax_snapshot = json_decode($o->tax_snapshot, true);
        }
        $payments = DB::table('payments')->whereIn('order_id', $orders->pluck('id'))->get();
        $refunds = DB::table('refunds')->whereIn('payment_id', $payments->pluck('id'))->get();
        $data = [...$base, 'day' => $day, 'days' => DB::table('business_days')->latest()->limit(30)->get(), 'employees' => User::all(['id', 'name', 'role', 'employee_id', 'active']), 'tables' => DB::table('dining_tables')->orderBy('id')->get(), 'categories' => DB::table('categories')->get(), 'extra_groups' => Support::jsonRows('extra_groups', ['modifiers']), 'products' => Support::jsonRows('products', ['variants', 'modifiers', 'extra_group_ids'])->map(function ($p) {
            $p->own_modifiers = $p->modifiers;
            $p->extra_group_ids ??= $p->extra_group_id ? [$p->extra_group_id] : [];
            $p->extra_group_ids = array_values(array_unique(array_map('intval', $p->extra_group_ids)));
            $p->modifiers = Support::productExtras($p);

            return $p;
        }), 'promotions' => $manager ? DB::table('promotions')->get() : DB::table('promotions')->whereNull('code')->where('active', true)->get(), 'terminals' => DB::table('terminals')->get(), 'orders' => $orders, 'payments' => $payments, 'refunds' => $refunds, 'reservations' => DB::table('reservations')->where('ends_at', '>=', now()->subDay())->orderBy('starts_at')->get(), 'summary' => (new Reports)->summary($day?->id, $manager ? null : $user->id), 'my_summary' => (new Reports)->summary($day?->id, $user->id), 'daily_summaries' => DB::table('daily_summaries')->where('business_day_id', $day?->id ?? 0)->when(! $manager, fn ($q) => $q->where('user_id', $user->id))->get()];
        if ($manager) {
            $data['sessions'] = DB::table('staff_sessions')->latest('started_at')->limit(200)->get()->map(function ($x) {
                $x->online = ! $x->ended_at && CarbonImmutable::parse($x->last_seen_at)->gt(now()->subMinutes(2));
                $x->inactive_detected_at = ! $x->ended_at && ! $x->online ? CarbonImmutable::parse($x->last_seen_at)->addMinutes(2)->toIso8601String() : null;

                return $x;
            });
            $data['audit'] = Support::jsonRows('audit_events', ['details'])->sortByDesc('id')->take(150)->values();
            $data['reconciliations'] = DB::table('reconciliations')->where('business_day_id', $day?->id ?? 0)->get();
            $data['terminal_totals'] = DB::table('terminals')->get()->map(fn ($t) => ['id' => $t->id, 'expected_cents' => $day ? (new Reports)->terminalTotal($day->id, $t->id) : 0]);
            $data['cashier_reports'] = User::all(['id', 'name'])->map(fn ($u) => ['id' => $u->id, 'name' => $u->name, 'summary' => (new Reports)->summary($day?->id, $u->id)]);
        }

        return $data;
    }
}
