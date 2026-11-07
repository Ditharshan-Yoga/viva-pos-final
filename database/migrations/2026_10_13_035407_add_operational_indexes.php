<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $t) {
            $t->json('promotion_snapshot')->nullable();
            $t->index(['status', 'updated_at']);
            $t->index(['dining_table_id', 'status']);
        });
        Schema::table('payments', fn (Blueprint $t) => $t->index('created_at'));
        Schema::table('refunds', fn (Blueprint $t) => $t->index('created_at'));
        Schema::table('kitchen_tickets', fn (Blueprint $t) => $t->index(['status', 'updated_at']));
        Schema::table('staff_sessions', fn (Blueprint $t) => $t->index(['user_id', 'last_seen_at']));
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $t) {
            $t->dropColumn('promotion_snapshot');
            $t->dropIndex(['status', 'updated_at']);
            $t->dropIndex(['dining_table_id', 'status']);
        });
        Schema::table('payments', fn (Blueprint $t) => $t->dropIndex(['created_at']));
        Schema::table('refunds', fn (Blueprint $t) => $t->dropIndex(['created_at']));
        Schema::table('kitchen_tickets', fn (Blueprint $t) => $t->dropIndex(['status', 'updated_at']));
        Schema::table('staff_sessions', fn (Blueprint $t) => $t->dropIndex(['user_id', 'last_seen_at']));
    }
};
