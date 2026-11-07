<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', fn (Blueprint $t) => $t->json('extra_group_ids')->nullable());
        DB::table('products')->whereNotNull('extra_group_id')->orderBy('id')->each(function ($p) {
            DB::table('products')->where('id', $p->id)->update(['extra_group_ids' => json_encode([$p->extra_group_id])]);
        });
        Schema::table('orders', function (Blueprint $t) {
            $t->text('delivery_address')->nullable();
            $t->unsignedInteger('delivery_fee_cents')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $t) => $t->dropColumn(['delivery_address', 'delivery_fee_cents']));
        Schema::table('products', fn (Blueprint $t) => $t->dropColumn('extra_group_ids'));
    }
};
