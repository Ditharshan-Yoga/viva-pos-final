<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Support;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Inertia\Inertia;

class AuthController extends Controller
{
    public function page()
    {
        return Inertia::render('Login', ['business' => Support::settings()['business_name'] ?? 'Forno Pizza & Bar']);
    }

    public function login(Request $r)
    {
        $v = $r->validate(['pin' => 'required|digits_between:4,8', 'device' => 'nullable|string|max:100']);
        $matches = User::where('active', true)->get()->filter(fn ($u) => $u->pin_hash && Hash::check($v['pin'], $u->pin_hash));
        Support::fail($matches->count() !== 1, 'PIN is incorrect or unavailable. Ask your Manager if you need help.');
        $u = $matches->first();
        $this->end($r);
        Auth::login($u);
        $r->session()->regenerate();
        $r->session()->forget(['kitchen', 'kitchen_version']);
        $id = (string) Str::uuid();
        DB::table('staff_sessions')->insert(['id' => $id, 'user_id' => $u->id, 'device' => $v['device'] ?? 'Browser', 'started_at' => now(), 'last_seen_at' => now()]);
        $r->session()->put('staff_session', $id);
        Support::audit('user.login', $u->name);

        return redirect('/');
    }

    public function logout(Request $r)
    {
        $this->end($r);
        Support::audit('user.logout');
        Auth::logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();

        return redirect('/login');
    }

    private function end(Request $r): void
    {
        if ($id = $r->session()->get('staff_session')) {
            DB::table('staff_sessions')->where('id', $id)->whereNull('ended_at')->update(['ended_at' => now(), 'end_reason' => 'logout']);
        }
    }
}
