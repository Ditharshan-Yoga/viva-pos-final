
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Add only missing columns to the existing users table.
        $userColumns = [
            'employee_id' => fn (Blueprint $t) => $t->string('employee_id')->unique()->nullable(),
            'role'        => fn (Blueprint $t) => $t->string('role')->default('cashier'),
            'pin_hash'    => fn (Blueprint $t) => $t->string('pin_hash')->nullable(),
            'active'      => fn (Blueprint $t) => $t->boolean('active')->default(true),
        ];

        foreach ($userColumns as $column => $definition) {
            if (!Schema::hasColumn('users', $column)) {
                Schema::table('users', $definition);
            }
        }

        if (!Schema::hasTable('settings')) {
            Schema::create('settings', function (Blueprint $t) {
                $t->id();
                $t->string('name')->unique();
                $t->json('value');
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('staff_sessions')) {
            Schema::create('staff_sessions', function (Blueprint $t) {
                $t->uuid('id')->primary();
                $t->foreignId('user_id')->constrained();
                $t->string('device', 100);
                $t->timestamp('started_at')->useCurrent();
                $t->timestamp('last_seen_at')->useCurrent();
                $t->timestamp('ended_at')->nullable();
                $t->string('end_reason')->nullable();
            });
        }

        if (!Schema::hasTable('business_days')) {
            Schema::create('business_days', function (Blueprint $t) {
                $t->id();
                $t->string('business_date');
                $t->string('status')->default('open');
                $t->foreignId('opened_by')->constrained('users');
                $t->timestamp('opened_at');
                $t->foreignId('closed_by')->nullable()->constrained('users');
                $t->timestamp('closed_at')->nullable();
                $t->json('closing_snapshot')->nullable();
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('daily_summaries')) {
            Schema::create('daily_summaries', function (Blueprint $t) {
                $t->id();
                $t->foreignId('business_day_id')->constrained();
                $t->foreignId('user_id')->constrained();
                $t->json('summary');
                $t->timestamp('submitted_at');
                $t->unique(['business_day_id', 'user_id']);
            });
        }

        if (!Schema::hasTable('dining_tables')) {
            Schema::create('dining_tables', function (Blueprint $t) {
                $t->id();
                $t->string('name')->unique();
                $t->unsignedInteger('seats');
                $t->boolean('active')->default(true);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('categories')) {
            Schema::create('categories', function (Blueprint $t) {
                $t->id();
                $t->string('name')->unique();
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('products')) {
            Schema::create('products', function (Blueprint $t) {
                $t->id();
                $t->foreignId('category_id')->constrained();
                $t->string('name');
                $t->unsignedInteger('price_cents');
                $t->boolean('kitchen')->default(true);
                $t->boolean('active')->default(true);
                $t->json('variants')->nullable();
                $t->json('modifiers')->nullable();
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('promotions')) {
            Schema::create('promotions', function (Blueprint $t) {
                $t->id();
                $t->string('name');
                $t->string('code')->nullable()->unique();
                $t->string('type');
                $t->unsignedInteger('value');
                $t->boolean('active')->default(true);
                $t->timestamp('starts_at')->nullable();
                $t->timestamp('ends_at')->nullable();
                $t->unsignedInteger('usage_limit')->nullable();
                $t->unsignedInteger('uses')->default(0);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('terminals')) {
            Schema::create('terminals', function (Blueprint $t) {
                $t->id();
                $t->string('name');
                $t->string('identifier')->unique();
                $t->string('provider')->nullable();
                $t->string('provider_id')->nullable();
                $t->string('location')->nullable();
                $t->text('notes')->nullable();
                $t->boolean('active')->default(true);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('reservations')) {
            Schema::create('reservations', function (Blueprint $t) {
                $t->id();
                $t->foreignId('dining_table_id')->constrained();
                $t->string('name');
                $t->string('phone')->nullable();
                $t->unsignedInteger('guests');
		$t->timestamp('starts_at')->useCurrent();
		$t->timestamp('ends_at')->useCurrent();
                $t->string('status')->default('upcoming');
                $t->text('notes')->nullable();
                $t->foreignId('created_by')->constrained('users');
                $t->timestamps();
                $t->index(['dining_table_id', 'starts_at', 'ends_at']);
            });
        }

        if (!Schema::hasTable('orders')) {
            Schema::create('orders', function (Blueprint $t) {
                $t->id();
                $t->uuid('request_key')->unique();
                $t->foreignId('business_day_id')->constrained();
                $t->foreignId('dining_table_id')->nullable()->constrained();
                $t->foreignId('reservation_id')->nullable()->constrained();
                $t->foreignId('created_by')->constrained('users');
                $t->foreignId('attended_by')->constrained('users');
                $t->string('type');
                $t->string('status')->default('open');
                $t->string('customer_name')->nullable();
                $t->string('phone')->nullable();
                $t->text('notes')->nullable();
                $t->foreignId('promotion_id')->nullable()->constrained();
                $t->unsignedInteger('version')->default(1);
                $t->unsignedInteger('subtotal_cents')->default(0);
                $t->unsignedInteger('discount_cents')->default(0);
                $t->unsignedInteger('tax_cents')->default(0);
                $t->unsignedInteger('total_cents')->default(0);
                $t->integer('rounding_cents')->default(0);
                $t->json('tax_snapshot')->nullable();
                $t->string('promotion_name')->nullable();
                $t->text('cancel_reason')->nullable();
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('order_items')) {
            Schema::create('order_items', function (Blueprint $t) {
                $t->id();
                $t->foreignId('order_id')->constrained();
                $t->foreignId('product_id')->constrained();
                $t->string('name');
                $t->unsignedInteger('unit_cents');
                $t->unsignedInteger('quantity');
                $t->boolean('kitchen');
                $t->json('configuration')->nullable();
                $t->text('notes')->nullable();
                $t->unsignedInteger('sent_quantity')->default(0);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('kitchen_tickets')) {
            Schema::create('kitchen_tickets', function (Blueprint $t) {
                $t->id();
                $t->foreignId('order_id')->constrained();
                $t->string('label');
                $t->string('kind')->default('new');
                $t->string('status')->default('new');
                $t->json('items');
                $t->boolean('acknowledged')->default(false);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('payments')) {
            Schema::create('payments', function (Blueprint $t) {
                $t->id();
                $t->uuid('request_key')->unique();
                $t->foreignId('order_id')->unique()->constrained();
                $t->foreignId('user_id')->constrained();
                $t->foreignId('tip_owner_id')->constrained('users');
                $t->foreignId('terminal_id')->nullable()->constrained();
                $t->string('method');
                $t->string('reference')->nullable();
                $t->unsignedInteger('amount_cents');
                $t->unsignedInteger('tip_cents')->default(0);
                $t->unsignedInteger('tendered_cents')->nullable();
                $t->unsignedInteger('change_cents')->default(0);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('refunds')) {
            Schema::create('refunds', function (Blueprint $t) {
                $t->id();
                $t->uuid('request_key')->unique();
                $t->foreignId('payment_id')->unique()->constrained();
                $t->foreignId('business_day_id')->constrained();
                $t->foreignId('requested_by')->constrained('users');
                $t->foreignId('approved_by')->constrained('users');
                $t->string('reference')->nullable();
                $t->text('reason');
                $t->unsignedInteger('amount_cents');
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('reconciliations')) {
            Schema::create('reconciliations', function (Blueprint $t) {
                $t->id();
                $t->foreignId('business_day_id')->constrained();
                $t->foreignId('terminal_id')->constrained();
                $t->integer('expected_cents');
                $t->integer('actual_cents');
                $t->text('notes')->nullable();
                $t->foreignId('user_id')->constrained();
                $t->timestamps();
                $t->unique(['business_day_id', 'terminal_id']);
            });
        }

        if (!Schema::hasTable('audit_events')) {
            Schema::create('audit_events', function (Blueprint $t) {
                $t->id();
                $t->foreignId('user_id')->nullable()->constrained();
                $t->string('actor');
                $t->string('action');
                $t->string('subject')->nullable();
                $t->json('details')->nullable();
                $t->timestamp('created_at');
            });
        }
    }

    public function down(): void
    {
        foreach ([
            'audit_events',
            'reconciliations',
            'refunds',
            'payments',
            'kitchen_tickets',
            'order_items',
            'orders',
            'reservations',
            'terminals',
            'promotions',
            'products',
            'categories',
            'dining_tables',
            'daily_summaries',
            'business_days',
            'staff_sessions',
            'settings',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        $columns = ['employee_id', 'role', 'pin_hash', 'active'];

        foreach ($columns as $column) {
            if (Schema::hasColumn('users', $column)) {
                Schema::table('users', function (Blueprint $t) use ($column) {
                    $t->dropColumn($column);
                });
            }
        }
    }
};
