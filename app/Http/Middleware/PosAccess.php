<?php

namespace App\Http\Middleware;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PosAccess
{
    public function handle(Request $r, Closure $next)
    {
        if (Auth::check()) {
            $session = DB::table('staff_sessions')->where('id', $r->session()->get('staff_session'))->first();
            if (! Auth::user()->active || ! $session || $session->ended_at) {
                Auth::logout();

                return $r->expectsJson() ? response()->json(['message' => 'Session ended. Please sign in.'], 401) : redirect('/login');
            }
            if (CarbonImmutable::parse($session->last_seen_at)->lt(now()->subMinutes(2))) {
                DB::table('staff_sessions')->where('id', $session->id)->update(['ended_at' => CarbonImmutable::parse($session->last_seen_at)->addMinutes(2), 'end_reason' => 'inactivity_detected']);
                $id = (string) Str::uuid();
                DB::table('staff_sessions')->insert(['id' => $id, 'user_id' => Auth::id(), 'device' => $session->device, 'started_at' => now(), 'last_seen_at' => now()]);
                $r->session()->put('staff_session', $id);
            } else {
                DB::table('staff_sessions')->where('id', $session->id)->update(['last_seen_at' => now()]);
            }

            return $next($r);
        }
        $r->session()->forget(['kitchen', 'kitchen_version']);

        return $r->expectsJson() ? response()->json(['message' => 'Sign in to continue.'], 401) : redirect('/login');
    }
}
