<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt INV-{{ str_pad($order->id,6,'0',STR_PAD_LEFT) }}</title>
<style>body{font:14px monospace;max-width:320px;margin:30px auto;color:#111}h1{text-align:center;font-size:22px}p{white-space:pre-wrap}.line{display:flex;justify-content:space-between;gap:8px;margin:8px 0}.amount{white-space:nowrap}hr{border:0;border-top:1px dashed #888}button{padding:12px;width:100%;margin-top:20px}@media print{button{display:none}body{margin:0 auto}}</style>
</head><body>
@php
    $currency = $settings['currency'] ?? 'CAD';
    $money = fn ($cents) => ($currency === 'CAD' ? '$' : $currency.' ').number_format($cents / 100, 2);
@endphp
<h1>{{ $settings['business_name'] }}</h1>
<p>Customer receipt · {{ $currency }}</p>
<p>{{ $order->type === 'delivery' ? 'Delivery' : ($order->type === 'takeout' ? 'Takeaway' : 'Dine-in') }}@if($order->type === 'delivery')<br>{{ $order->customer_name }}<br>{{ $order->phone }}<br>{{ $order->delivery_address }}@endif</p>
<p>{{ $settings['address'] ?? '' }}<br>{{ $settings['phone'] ?? '' }}</p>
<p>INV-{{ str_pad($order->id,6,'0',STR_PAD_LEFT) }}<br>{{ \Carbon\Carbon::parse($payment->created_at)->timezone($settings['timezone'])->format('Y-m-d H:i') }}<br>{{ strtoupper($order->status) }}</p><hr>
@foreach($items as $item)
<div class="line"><span>{{ $item->quantity }} × {{ $item->name }}</span><span class="amount">{{ $money($item->quantity * $item->unit_cents) }}</span></div>
<small>{{ implode(', ',json_decode($item->configuration,true)??[]) }}</small>
@endforeach
<hr>
@if($order->delivery_fee_cents > 0)<div class="line"><span>Delivery fee (in subtotal)</span><span class="amount">{{ $money($order->delivery_fee_cents) }}</span></div>@endif
@foreach(['Subtotal'=>$order->subtotal_cents,'Discount'=>-$order->discount_cents,(json_decode($order->tax_snapshot,true)['inclusive']?'Tax (included)':'Tax')=>$order->tax_cents,'Cash rounding'=>$order->rounding_cents,'Bill'=>$payment->amount_cents,'Tip'=>$payment->tip_cents,'Total paid'=>$payment->amount_cents+$payment->tip_cents] as $label=>$amount)
<div class="line"><span>{{ $label }}</span><span class="amount">{{ $money($amount) }}</span></div>
@endforeach
<p>{{ strtoupper($payment->method) }} {{ $payment->reference }}@if($payment->method==='cash')<br>Received {{ $money($payment->tendered_cents) }}<br>Change {{ $money($payment->change_cents) }}@endif</p>
<p>{{ $settings['receipt_footer'] ?? '' }}</p><button onclick="window.print()">Print receipt</button>
</body></html>
