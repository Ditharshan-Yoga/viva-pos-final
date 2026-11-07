<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;

class PosUpdated implements ShouldBroadcast
{
    use Dispatchable;

    public function broadcastWhen(): bool
    {
        return config('broadcasting.default') === 'reverb';
    }

    public function broadcastOn(): array
    {
        return [new Channel('pos-refresh')];
    }

    public function broadcastAs(): string
    {
        return 'updated';
    }

    public function broadcastWith(): array
    {
        return [];
    }
}
