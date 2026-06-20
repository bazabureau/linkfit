<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class ConversationUpdated implements ShouldBroadcastNow
{
    use Dispatchable;
    use InteractsWithSockets;

    /**
     * @param  array<int,string>  $userIds
     */
    public function __construct(
        public string $conversationId,
        public array $userIds,
        public string $reason = 'updated',
    ) {}

    /**
     * @return array<int,PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return array_map(
            fn (string $userId) => new PrivateChannel('user.'.$userId),
            array_values(array_unique($this->userIds)),
        );
    }

    public function broadcastAs(): string
    {
        return 'conversation.updated';
    }

    /**
     * @return array<string,mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'conversation_id' => $this->conversationId,
            'reason' => $this->reason,
        ];
    }
}
