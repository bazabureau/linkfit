<?php

namespace App\Services\Notifications;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReminderDispatcher
{
    public function process(int $windowMinutes = 120, int $lookaheadMinutes = 150): array
    {
        $windowMinutes = min(max($windowMinutes, 15), 1440);
        $lookaheadMinutes = max($windowMinutes, min(max($lookaheadMinutes, 15), 2880));
        $from = now()->addMinutes($windowMinutes - 15);
        $to = now()->addMinutes($lookaheadMinutes);

        return [
            'game_reminders' => $this->gameReminders($from, $to, $windowMinutes),
            'booking_reminders' => $this->bookingReminders($from, $to, $windowMinutes),
        ];
    }

    private function gameReminders(mixed $from, mixed $to, int $windowMinutes): int
    {
        $rows = DB::table('games as g')
            ->join('game_participants as gp', 'gp.game_id', '=', 'g.id')
            ->leftJoin('game_reminders_sent as grs', function ($join) {
                $join->on('grs.game_id', '=', 'g.id')->on('grs.user_id', '=', 'gp.user_id');
            })
            ->whereNull('grs.game_id')
            ->whereIn('g.status', ['open', 'full'])
            ->where('gp.status', 'confirmed')
            ->whereBetween('g.starts_at', [$from, $to])
            ->limit(500)
            ->get(['g.id as game_id', 'gp.user_id', 'g.starts_at']);

        $sent = 0;
        foreach ($rows as $row) {
            $inserted = DB::table('game_reminders_sent')->insertOrIgnore([
                'game_id' => $row->game_id,
                'user_id' => $row->user_id,
                'sent_at' => now(),
            ]);
            if ($inserted > 0) {
                $this->enqueueNotification((string) $row->user_id, 'game_reminder', 'Game reminder', 'Your game starts soon.', [
                    'game_id' => $row->game_id,
                    'starts_at' => $row->starts_at,
                    'window_minutes' => $windowMinutes,
                ]);
                $sent++;
            }
        }

        return $sent;
    }

    private function bookingReminders(mixed $from, mixed $to, int $windowMinutes): int
    {
        $rows = DB::table('bookings as b')
            ->leftJoin('booking_reminders_sent as brs', function ($join) {
                $join->on('brs.booking_id', '=', 'b.id')->on('brs.user_id', '=', 'b.user_id');
            })
            ->whereNull('brs.booking_id')
            ->whereNotNull('b.user_id')
            ->whereIn('b.status', ['pending_payment', 'partially_paid', 'paid'])
            ->whereBetween('b.starts_at', [$from, $to])
            ->limit(500)
            ->get(['b.id as booking_id', 'b.user_id', 'b.starts_at']);

        $sent = 0;
        foreach ($rows as $row) {
            $inserted = DB::table('booking_reminders_sent')->insertOrIgnore([
                'booking_id' => $row->booking_id,
                'user_id' => $row->user_id,
                'sent_at' => now(),
            ]);
            if ($inserted > 0) {
                $this->enqueueNotification((string) $row->user_id, 'system', 'Booking reminder', 'Your court booking starts soon.', [
                    'kind' => 'booking_reminder',
                    'booking_id' => $row->booking_id,
                    'starts_at' => $row->starts_at,
                    'window_minutes' => $windowMinutes,
                ]);
                $sent++;
            }
        }

        return $sent;
    }

    private function enqueueNotification(string $userId, string $type, string $title, string $body, array $payload = []): void
    {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'payload' => json_encode($payload),
            'created_at' => now(),
        ]);
        DB::table('push_notification_jobs')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'payload' => json_encode($payload),
            'available_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
