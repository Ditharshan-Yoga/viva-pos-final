<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('extra_groups', function (Blueprint $t) {
            $t->id();
            $t->string('name', 80);
            $t->json('modifiers');
            $t->timestamps();
        });
        Schema::table('products', function (Blueprint $t) {
            $t->unsignedBigInteger('extra_group_id')->nullable();
            $t->string('department', 20)->default('restaurant');
            $t->unsignedInteger('takeout_price_cents')->nullable();
            $t->mediumText('photo')->nullable();
        });
        Schema::table('order_items', fn (Blueprint $t) => $t->string('department', 20)->default('legacy'));
        Schema::table('dining_tables', function (Blueprint $t) {
            $t->string('area', 60)->default('Restaurant');
            $t->string('department', 20)->default('restaurant');
        });
        DB::table('products')->whereIn('category_id', DB::table('categories')->whereRaw('LOWER(name) = ?', ['bar'])->select('id'))->update(['department' => 'bar']);
    }

    public function down(): void
    {
        Schema::dropIfExists('extra_groups');
        Schema::table('products', fn (Blueprint $t) => $t->dropColumn(['department', 'takeout_price_cents', 'photo', 'extra_group_id']));
        Schema::table('order_items', fn (Blueprint $t) => $t->dropColumn('department'));
        Schema::table('dining_tables', fn (Blueprint $t) => $t->dropColumn(['area', 'department']));
    }
};
