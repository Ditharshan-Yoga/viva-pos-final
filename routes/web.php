<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\PosController;
use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Route;

Route::get('/login', [AuthController::class, 'page'])->name('login');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

Route::post('/logout', [AuthController::class, 'logout']);
Route::middleware('pos')->group(function () {
    Route::get('/', [PosController::class, 'page']);
    Route::redirect('/kitchen', '/');
    Route::get('/api/reports', [ReportController::class, 'index']);
    Route::get('/api/orders', [PosController::class, 'history']);
    Route::get('/api/state', [PosController::class, 'state']);
    Route::get('/api/available-tables', [PosController::class, 'availableTables']);
    Route::post('/api/actions/{action}', [PosController::class, 'action'])->middleware('throttle:120,1');
    Route::post('/api/kitchen/{id}', [PosController::class, 'kitchen']);
    Route::get('/kitchen-tickets/{id}/print', [PosController::class, 'kitchenPrint']);
    Route::get('/receipts/{id}', [PosController::class, 'receipt']);
});
Broadcast::routes(['middleware' => ['web', 'pos']]);
Broadcast::channel('pos', fn ($user) => $user?->active === true);
