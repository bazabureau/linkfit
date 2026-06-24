<?php

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Race-safe get-or-create for 1:1 (direct) conversations.
 *
 * A plain check-then-insert lets two concurrent calls (e.g. both users open the
 * thread at once, or a story reply races a normal DM) mint duplicate threads,
 * splitting DM history. This serialises per user-pair with a Postgres
 * transaction-scoped advisory lock keyed on a stable hash of the sorted id
 * pair, then re-runs the existing-conversation lookup INSIDE the transaction
 * before inserting. On non-pgsql (sqlite test harness) the advisory lock is a
 * no-op and the in-transaction recheck still prevents the common interleavings.
 */
trait ResolvesDirectConversations
{
    /**
     * Returns the conversation id for the 1:1 thread between $userId and
     * $otherUserId, creating it if missing. Resurrects a left_at on both
     * participant rows for an existing thread. Must be called inside a
     * DB::transaction so the advisory lock is held for the insert window.
     */
    protected function getOrCreateDirectConversation(string $userId, string $otherUserId): string
    {
        $this->lockDirectConversationPair($userId, $otherUserId);

        $existing = DB::table('conversation_participants as a')
            ->join('conversation_participants as b', 'b.conversation_id', '=', 'a.conversation_id')
            ->join('conversations as c', 'c.id', '=', 'a.conversation_id')
            ->where('a.user_id', $userId)
            ->where('b.user_id', $otherUserId)
            ->where(fn ($q) => $q->where('c.kind', 'direct')->orWhereNull('c.kind'))
            ->value('a.conversation_id');

        if ($existing !== null) {
            DB::table('conversation_participants')
                ->where('conversation_id', $existing)
                ->whereIn('user_id', [$userId, $otherUserId])
                ->update(['left_at' => null]);

            return (string) $existing;
        }

        $id = (string) Str::uuid();
        DB::table('conversations')->insert(['id' => $id, 'kind' => 'direct', 'created_at' => now()]);
        DB::table('conversation_participants')->insert([
            ['conversation_id' => $id, 'user_id' => $userId],
            ['conversation_id' => $id, 'user_id' => $otherUserId],
        ]);

        return $id;
    }

    /**
     * Take a transaction-scoped advisory lock keyed on the sorted user-id pair so
     * concurrent direct-conversation creation for the SAME pair serialises.
     * pg_advisory_xact_lock auto-releases at commit/rollback. No-op off pgsql.
     */
    private function lockDirectConversationPair(string $userId, string $otherUserId): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        $pair = [$userId, $otherUserId];
        sort($pair);
        // crc32 → 32-bit; pg_advisory_xact_lock(key1 int, key2 int) takes two.
        $key1 = crc32($pair[0]);
        $key2 = crc32($pair[1]);
        // Map unsigned crc32 into signed 32-bit range Postgres expects.
        $key1 = $key1 >= 2147483648 ? $key1 - 4294967296 : $key1;
        $key2 = $key2 >= 2147483648 ? $key2 - 4294967296 : $key2;
        DB::statement('SELECT pg_advisory_xact_lock(?, ?)', [$key1, $key2]);
    }
}
