<?php

use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A user may listen on a conversation's private channel only if they are an
 * active participant. $user is resolved by the JWT middleware on the
 * /broadcasting/auth route (see bootstrap/app.php withBroadcasting).
 */
Broadcast::channel('conversation.{conversationId}', function ($user, string $conversationId) {
    // Fail closed: the JWT middleware guarantees a user, but never authorize a
    // private channel for an unresolved/null actor.
    if ($user === null) {
        return false;
    }

    // Guard the uuid conversation_id column: a malformed channel name (e.g.
    // conversation.foo) must fail closed rather than raise a Postgres
    // invalid-input-syntax-for-uuid error (500) on /broadcasting/auth.
    if (! Str::isUuid($conversationId)) {
        return false;
    }

    return DB::table('conversation_participants')
        ->where('conversation_id', $conversationId)
        ->where('user_id', $user->id)
        ->whereNull('left_at')
        ->exists();
});

Broadcast::channel('user.{userId}', function ($user, string $userId) {
    return $user !== null && (string) $user->id === $userId;
});
