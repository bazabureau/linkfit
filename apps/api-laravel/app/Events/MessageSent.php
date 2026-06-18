<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Real-time chat message. Broadcast on the per-conversation private channel.
 * Broadcasts immediately (ShouldBroadcastNow) so there is no queue dependency;
 * the publish is a fast local call to the Reverb server.
 */
class MessageSent implements ShouldBroadcastNow
{
    use Dispatchable;
    use InteractsWithSockets;

    /**
     * @param  array<string,mixed>  $message
     */
    public function __construct(
        public string $conversationId,
        public array $message,
    ) {}

    /**
     * @return array<int,PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->conversationId)];
    }

    public function broadcastAs(): string
    {
        return 'message.sent';
    }

    /**
     * @return array<string,mixed>
     */
    public function broadcastWith(): array
    {
        return ['message' => $this->message];
    }
}
