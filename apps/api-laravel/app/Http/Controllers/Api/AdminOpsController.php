<?php

namespace App\Http\Controllers\Api;

use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class AdminOpsController extends ApiController
{
    public function bootstrap(Request $request): JsonResponse
    {
        $admin = $this->staff($request, "dashboard");

        return response()->json([
            'stats' => $this->stats($request)->getData(true),
            'operations' => $this->hasAdminPermission($admin, 'operations') ? $this->operations($request)->getData(true) : null,
            'recent_bookings' => DB::table('bookings as b')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->orderByDesc('b.created_at')
                ->limit(10)
                ->get(['b.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name', 'u.display_name as booker_display_name', 'u.email as booker_email'])
                ->map(fn ($booking) => $this->bookingPayload($booking)),
            'recent_users' => DB::table('users as u')
                ->orderByDesc('u.created_at')
                ->limit(10)
                ->get(['u.id', 'u.email', 'u.display_name', 'u.admin_role', 'u.deleted_at', 'u.created_at', 'u.venue_id'])
                ->map(fn ($user) => $this->adminUserPayload((object) [...((array) $user), 'games_played_total' => 0])),
            'venues_summary' => [
                'total' => DB::table('venues')->count(),
                'published' => DB::table('venues')->where('status', 'published')->count(),
                'pending' => DB::table('venues')->where('status', 'pending')->count(),
                'partner' => DB::table('venues')->where('is_partner', true)->count(),
            ],
        ]);
    }

    public function lookups(Request $request): JsonResponse
    {
        $this->staff($request, "dashboard");

        return response()->json([
            'sports' => DB::table('sports')->whereIn('slug', ['padel', 'tennis'])->orderByRaw("case when slug = 'padel' then 0 else 1 end")->get(['id', 'slug', 'name', 'min_players', 'max_players']),
            'venues' => DB::table('venues')->orderBy('name')->get(['id', 'name', 'status', 'is_partner', 'address']),
            'courts' => DB::table('courts as c')->join('venues as v', 'v.id', '=', 'c.venue_id')->join('sports as s', 's.id', '=', 'c.sport_id')->orderBy('v.name')->orderBy('c.name')->get(['c.id', 'c.name', 'c.venue_id', 'v.name as venue_name', 'c.status', 'c.hourly_price_minor', 'c.currency', 's.slug as sport_slug']),
            'booking_statuses' => ['pending_payment', 'partially_paid', 'paid', 'cancelled', 'refunded', 'failed'],
            'payment_methods' => ['onsite', 'cash', 'bank_transfer', 'manual'],
            'venue_statuses' => ['draft', 'pending', 'published', 'suspended'],
            'court_statuses' => ['active', 'inactive', 'maintenance'],
            'admin_roles' => ['admin', 'moderator', 'partner', 'coach'],
        ]);
    }

    public function stats(Request $request): JsonResponse
    {
        $this->staff($request, "dashboard");

        $now = now();
        $sevenDaysAgo = now()->subDays(7);
        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();
        $topVenues = DB::table('games as g')
            ->join('courts as c', 'c.id', '=', 'g.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->selectRaw('v.id, v.name, COUNT(g.id) as game_count')
            ->whereNull('g.deleted_at')
            ->groupBy('v.id', 'v.name')
            ->orderByDesc('game_count')
            ->limit(10)
            ->get()
            ->map(fn ($venue) => [
                'id' => (string) $venue->id,
                'name' => (string) $venue->name,
                'game_count' => (int) $venue->game_count,
            ])
            ->values();

        $usersTotal = DB::table('users')->whereNull('deleted_at')->count();
        $gamesTotal = DB::table('games')->whereNull('deleted_at')->count();
        $reportsPending = DB::table('reports')->where('status', 'pending')->count();
        $venuesTotal = DB::table('venues')->count();
        $bookingsTotal = DB::table('bookings')->count();
        $courtsTotal = DB::table('courts')->count();

        return response()->json([
            'users_total' => $usersTotal,
            'users_new_7d' => DB::table('users')->whereNull('deleted_at')->where('created_at', '>=', $sevenDaysAgo)->count(),
            'games_this_week' => DB::table('games')->whereNull('deleted_at')->where('starts_at', '>=', $sevenDaysAgo)->count(),
            'games_completed_total' => DB::table('games')->whereNull('deleted_at')->where('status', 'completed')->count(),
            'games_total' => $gamesTotal,
            'games_open_total' => DB::table('games')->whereNull('deleted_at')->where('status', 'open')->count(),
            'games_upcoming_total' => DB::table('games')
                ->whereNull('deleted_at')
                ->where('starts_at', '>=', $now)
                ->whereIn('status', ['open', 'full'])
                ->count(),
            'games_cancelled_7d' => DB::table('games')
                ->whereNull('deleted_at')
                ->where('status', 'cancelled')
                ->where('updated_at', '>=', $sevenDaysAgo)
                ->count(),
            'venues_total' => $venuesTotal,
            'partner_venues_total' => DB::table('venues')->where('is_partner', true)->count(),
            'courts_total' => $courtsTotal,
            'courts_padel_total' => DB::table('courts as c')->join('sports as s', 's.id', '=', 'c.sport_id')->where('s.slug', 'padel')->count(),
            'courts_tennis_total' => DB::table('courts as c')->join('sports as s', 's.id', '=', 'c.sport_id')->where('s.slug', 'tennis')->count(),
            'bookings_total' => $bookingsTotal,
            'bookings_today' => DB::table('bookings')->whereBetween('starts_at', [$todayStart, $todayEnd])->count(),
            'bookings_upcoming_total' => DB::table('bookings')
                ->where('starts_at', '>=', $now)
                ->whereNotIn('status', ['cancelled', 'refunded', 'failed'])
                ->count(),
            'bookings_unpaid_total' => DB::table('bookings')->whereIn('status', ['pending_payment', 'partially_paid'])->count(),
            'booking_revenue_paid_minor' => (int) DB::table('bookings')->where('status', 'paid')->sum('total_minor'),
            'tournaments_upcoming_total' => DB::table('tournaments')
                ->where('starts_at', '>=', $now)
                ->whereNotIn('status', ['completed', 'cancelled'])
                ->count(),
            'partner_accounts_total' => DB::table('users')->whereNull('deleted_at')->where('admin_role', 'partner')->count(),
            'coach_accounts_total' => DB::table('users')->whereNull('deleted_at')->where('admin_role', 'coach')->count(),
            'admin_accounts_total' => DB::table('users')->whereNull('deleted_at')->whereIn('admin_role', ['admin', 'moderator'])->count(),
            'reports_total' => DB::table('reports')->count(),
            'top_venues' => $topVenues,
            'pending_reports' => $reportsPending,
            'generated_at' => $now->toIso8601String(),
            // Legacy admin counters kept for older callers.
            'users' => $usersTotal,
            'games' => $gamesTotal,
            'venues' => $venuesTotal,
            'bookings' => $bookingsTotal,
            'reports_pending' => $reportsPending,
        ]);
    }

    public function metrics(Request $request): JsonResponse
    {
        $this->staff($request, "revenue");
        $days = min(max((int) $request->query('days', 30), 1), 365);
        $from = now()->subDays($days - 1)->startOfDay();
        $to = now()->endOfDay();

        $bookings = DB::table('bookings')
            ->whereBetween('starts_at', [$from, $to])
            ->selectRaw("date_trunc('day', starts_at) as day, COUNT(*) as bookings_count, SUM(CASE WHEN status = 'paid' THEN total_minor ELSE 0 END) as paid_revenue_minor")
            ->groupByRaw("date_trunc('day', starts_at)")
            ->orderBy('day')
            ->get()
            ->keyBy(fn ($row) => CarbonImmutable::parse($row->day)->format('Y-m-d'));
        $users = DB::table('users')
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("date_trunc('day', created_at) as day, COUNT(*) as users_count")
            ->groupByRaw("date_trunc('day', created_at)")
            ->orderBy('day')
            ->get()
            ->keyBy(fn ($row) => CarbonImmutable::parse($row->day)->format('Y-m-d'));
        $games = DB::table('games')
            ->whereNull('deleted_at')
            ->whereBetween('starts_at', [$from, $to])
            ->selectRaw("date_trunc('day', starts_at) as day, COUNT(*) as games_count")
            ->groupByRaw("date_trunc('day', starts_at)")
            ->orderBy('day')
            ->get()
            ->keyBy(fn ($row) => CarbonImmutable::parse($row->day)->format('Y-m-d'));

        $daily = [];
        for ($day = CarbonImmutable::parse($from); $day <= CarbonImmutable::parse($to); $day = $day->addDay()) {
            $key = $day->format('Y-m-d');
            $booking = $bookings->get($key);
            $user = $users->get($key);
            $game = $games->get($key);
            $daily[] = [
                'date' => $key,
                'bookings_count' => (int) ($booking->bookings_count ?? 0),
                'paid_revenue_minor' => (int) ($booking->paid_revenue_minor ?? 0),
                'users_count' => (int) ($user->users_count ?? 0),
                'games_count' => (int) ($game->games_count ?? 0),
            ];
        }

        return response()->json([
            'from' => $this->iso($from),
            'to' => $this->iso($to),
            'daily' => $daily,
            'top_venues' => DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->whereBetween('b.starts_at', [$from, $to])
                ->selectRaw("v.id as venue_id, v.name as venue_name, COUNT(*) as bookings_count, SUM(CASE WHEN b.status = 'paid' THEN b.total_minor ELSE 0 END) as paid_revenue_minor")
                ->groupBy('v.id', 'v.name')
                ->orderByDesc('paid_revenue_minor')
                ->limit(10)
                ->get()
                ->map(fn ($row) => [
                    'venue_id' => (string) $row->venue_id,
                    'venue_name' => (string) $row->venue_name,
                    'bookings_count' => (int) $row->bookings_count,
                    'paid_revenue_minor' => (int) $row->paid_revenue_minor,
                ]),
        ]);
    }

    public function users(Request $request): JsonResponse
    {
        $this->staff($request, "users");

        $limit = min(max((int) $request->query('limit', 20), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $term = trim((string) $request->query('q', ''));
        $role = $request->query('role');
        $status = $request->query('status');
        $verification = $request->query('verification');
        $vip = $request->query('vip');
        $played = DB::table('game_participants')
            ->selectRaw('user_id, COUNT(*) as games_played_total')
            ->whereIn('status', ['confirmed', 'played', 'no_show'])
            ->groupBy('user_id');

        $query = DB::table('users as u')
            ->leftJoinSub($played, 'gp', 'gp.user_id', '=', 'u.id')
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(function ($qq) use ($like) {
                    $qq->where('u.display_name', 'ilike', $like)
                        ->orWhere('u.email', 'ilike', $like);
                });
            })
            ->when($role && $role !== 'all', function ($q) use ($role) {
                if ($role === 'user') {
                    $q->whereNull('u.admin_role');
                } elseif ($role === 'staff') {
                    $q->whereIn('u.admin_role', ['admin', 'moderator']);
                } else {
                    $q->where('u.admin_role', $role);
                }
            })
            ->when($status && $status !== 'all', function ($q) use ($status) {
                if ($status === 'deleted') {
                    $q->whereNotNull('u.deleted_at');
                } elseif ($status === 'suspended') {
                    $q->whereNotNull('u.suspended_at')->whereNull('u.deleted_at');
                } elseif ($status === 'active') {
                    $q->whereNull('u.deleted_at')->whereNull('u.suspended_at');
                }
            })
            ->when($verification && $verification !== 'all', function ($q) use ($verification) {
                if ($verification === 'verified') {
                    $q->whereNotNull('u.email_verified_at');
                } elseif ($verification === 'unverified') {
                    $q->whereNull('u.email_verified_at');
                }
            })
            ->when($vip && $vip !== 'all', function ($q) use ($vip) {
                if ($vip === 'vip') {
                    $q->where('u.is_vip', true);
                } elseif ($vip === 'standard') {
                    $q->where(function ($qq) {
                        $qq->where('u.is_vip', false)->orWhereNull('u.is_vip');
                    });
                }
            });

        $total = (clone $query)->count('u.id');
        $summaryBase = DB::table('users');
        $items = $query
            ->orderByDesc('u.created_at')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'u.id',
                'u.email',
                'u.display_name',
                'u.admin_role',
                'u.deleted_at',
                'u.created_at',
                'u.updated_at',
                'u.venue_id',
                'u.email_verified_at',
                'u.suspended_at',
                'u.suspension_reason',
                'u.suspended_by_user_id',
                'u.last_seen_at',
                'u.is_vip',
                'u.vip_badge_label',
                'u.vip_expires_at',
                'u.username',
                'u.is_verified',
                'u.is_ambassador',
                DB::raw('COALESCE(gp.games_played_total, 0) as games_played_total'),
            ])
            ->map(fn ($u) => $this->adminUserPayload($u))
            ->values();

        return response()->json([
            'items' => $items,
            'total' => $total,
            'results' => $items,
            'count' => $total,
            'summary' => [
                'total' => (clone $summaryBase)->count(),
                'active' => (clone $summaryBase)->whereNull('deleted_at')->count(),
                'deleted' => (clone $summaryBase)->whereNotNull('deleted_at')->count(),
                'suspended' => (clone $summaryBase)->whereNull('deleted_at')->whereNotNull('suspended_at')->count(),
                'verified' => (clone $summaryBase)->whereNull('deleted_at')->whereNotNull('email_verified_at')->count(),
                'unverified' => (clone $summaryBase)->whereNull('deleted_at')->whereNull('email_verified_at')->count(),
                'vip' => (clone $summaryBase)->whereNull('deleted_at')->where('is_vip', true)->count(),
                'regular' => (clone $summaryBase)->whereNull('deleted_at')->whereNull('admin_role')->count(),
                'admin' => (clone $summaryBase)->whereNull('deleted_at')->where('admin_role', 'admin')->count(),
                'moderator' => (clone $summaryBase)->whereNull('deleted_at')->where('admin_role', 'moderator')->count(),
                'partner' => (clone $summaryBase)->whereNull('deleted_at')->where('admin_role', 'partner')->count(),
                'coach' => (clone $summaryBase)->whereNull('deleted_at')->where('admin_role', 'coach')->count(),
                'staff' => (clone $summaryBase)->whereNull('deleted_at')->whereIn('admin_role', ['admin', 'moderator'])->count(),
            ],
        ]);
    }

    public function customers(Request $request): JsonResponse
    {
        $this->staff($request, "users");
        $term = trim((string) $request->query('q', ''));
        $limit = min(max((int) $request->query('limit', 50), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $bookingStats = DB::table('bookings')
            ->whereNotNull('user_id')
            ->selectRaw('user_id, COUNT(*) as bookings_count, MAX(starts_at) as last_booking_at, SUM(CASE WHEN status = ? THEN total_minor ELSE 0 END) as paid_total_minor', ['paid'])
            ->groupBy('user_id');
        $query = DB::table('users as u')
            ->leftJoinSub($bookingStats, 'bs', 'bs.user_id', '=', 'u.id')
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(fn ($w) => $w->where('u.display_name', 'ilike', $like)->orWhere('u.email', 'ilike', $like));
            })
            ->whereNull('u.deleted_at');
        $total = (clone $query)->count('u.id');
        $items = $query
            ->orderByDesc(DB::raw('COALESCE(bs.last_booking_at, u.created_at)'))
            ->offset($offset)
            ->limit($limit)
            ->get([
                'u.id',
                'u.email',
                'u.display_name',
                'u.photo_url',
                'u.created_at',
                DB::raw('COALESCE(bs.bookings_count, 0) as bookings_count'),
                DB::raw('COALESCE(bs.paid_total_minor, 0) as paid_total_minor'),
                'bs.last_booking_at',
            ])
            ->map(fn ($user) => [
                'id' => (string) $user->id,
                'email' => (string) $user->email,
                'display_name' => (string) $user->display_name,
                'photo_url' => $user->photo_url,
                'created_at' => $this->iso($user->created_at),
                'bookings_count' => (int) $user->bookings_count,
                'paid_total_minor' => (int) $user->paid_total_minor,
                'last_booking_at' => $this->iso($user->last_booking_at),
            ])
            ->values();

        return response()->json(['items' => $items, 'total' => $total]);
    }

    public function staffAccounts(Request $request): JsonResponse
    {
        $this->staff($request, "staff");

        return response()->json([
            'items' => DB::table('users')
                ->whereIn('admin_role', ['admin', 'moderator'])
                ->orderByDesc('created_at')
                ->get(['id', 'email', 'display_name', 'admin_role', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at'])
                ->map(fn ($user) => $this->staffAccountPayload($user))
                ->values(),
        ]);
    }

    public function createStaffAccount(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        // Admin-only: creating a staff account can mint a new admin, so this
        // must not be reachable via the grantable "staff" moderator permission.
        $this->staff($request);
        $data = $this->validateBody($request, [
            'email' => ['required', 'email', 'max:254'],
            'display_name' => ['required', 'string', 'min:1', 'max:80'],
            'password' => ['required', 'string', 'min:12', 'max:200'],
            'role' => ['required', 'in:admin,moderator'],
            'staff_title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'staff_permissions' => ['sometimes', 'nullable', 'array'],
        ]);
        $this->assertPasswordPolicy($data['password']);
        $email = mb_strtolower(trim($data['email']));
        if (DB::table('users')->where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }
        $id = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $id,
            'email' => $email,
            'password_hash' => app(PasswordService::class)->hash($data['password']),
            'display_name' => trim($data['display_name']),
            'admin_role' => $data['role'],
            'staff_title' => isset($data['staff_title']) ? trim((string) $data['staff_title']) : ($data['role'] === 'admin' ? 'Administrator' : 'Moderator'),
            'staff_permissions' => json_encode($this->normalizeAdminStaffPermissions($data['staff_permissions'] ?? null, $data['role'] === 'admin')),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'admin.staff.create', 'users', $id, ['role' => $data['role']]);

        return response()->json($this->staffAccountById($id), 201);
    }

    public function updateStaffAccount(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        // Admin-only: editing a staff account can promote to admin / change a
        // password, so it must not be reachable via a grantable moderator perm.
        $this->staff($request);
        $data = $this->validateBody($request, [
            'email' => ['sometimes', 'email', 'max:254'],
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'password' => ['sometimes', 'string', 'min:12', 'max:200'],
            'role' => ['sometimes', 'in:admin,moderator'],
            'staff_title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'staff_permissions' => ['sometimes', 'nullable', 'array'],
            'restore' => ['sometimes', 'boolean'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        $current = DB::table('users')->where('id', $id)->whereIn('admin_role', ['admin', 'moderator'])->first(['admin_role']);
        if ($current === null) {
            throw ApiException::notFound('Staff account not found');
        }
        $updates = ['updated_at' => now()];
        if (isset($data['email'])) {
            $email = mb_strtolower(trim($data['email']));
            if (DB::table('users')->where('email', $email)->where('id', '!=', $id)->exists()) {
                throw ApiException::conflict('Email is already registered');
            }
            $updates['email'] = $email;
        }
        if (isset($data['display_name'])) {
            $updates['display_name'] = trim($data['display_name']);
        }
        if (isset($data['password'])) {
            $this->assertPasswordPolicy($data['password']);
            $updates['password_hash'] = app(PasswordService::class)->hash($data['password']);
        }
        if (isset($data['role'])) {
            $updates['admin_role'] = $data['role'];
        }
        if (array_key_exists('staff_title', $data)) {
            $updates['staff_title'] = $data['staff_title'] !== null ? trim($data['staff_title']) : null;
        }
        if (array_key_exists('staff_permissions', $data)) {
            $roleForPermissions = (string) ($data['role'] ?? $current->admin_role);
            $updates['staff_permissions'] = json_encode($this->normalizeAdminStaffPermissions($data['staff_permissions'], $roleForPermissions === 'admin'));
        }
        if (($data['restore'] ?? false) === true) {
            $updates['deleted_at'] = null;
        }
        $updated = DB::table('users')->where('id', $id)->whereIn('admin_role', ['admin', 'moderator'])->update($updates);
        if ($updated === 0) {
            throw ApiException::notFound('Staff account not found');
        }
        $this->auditWrite($admin->id, 'admin.staff.update', 'users', $id, array_keys($updates));

        return response()->json($this->staffAccountById($id));
    }

    public function deleteStaffAccount(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        // Admin-only: deleting staff accounts is a privilege action.
        $this->staff($request);
        if ((string) $admin->id === $id) {
            throw ApiException::conflict('You cannot delete your own admin account');
        }
        $updated = DB::table('users')->where('id', $id)->whereIn('admin_role', ['admin', 'moderator'])->update(['deleted_at' => now(), 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Staff account not found');
        }
        $this->auditWrite($admin->id, 'admin.staff.delete', 'users', $id);

        return response()->json(null, 204);
    }

    public function search(Request $request): JsonResponse
    {
        $this->staff($request, "dashboard");
        $term = trim((string) $request->query('q', ''));
        if ($term === '') {
            return response()->json(['query' => '', 'users' => [], 'venues' => [], 'courts' => [], 'bookings' => []]);
        }
        $like = '%'.$term.'%';

        return response()->json([
            'query' => $term,
            'users' => DB::table('users')
                ->where(fn ($q) => $q->where('display_name', 'ilike', $like)->orWhere('email', 'ilike', $like))
                ->orderByDesc('created_at')
                ->limit(10)
                ->get(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'deleted_at', 'created_at']),
            'venues' => DB::table('venues')
                ->where(fn ($q) => $q->where('name', 'ilike', $like)->orWhere('address', 'ilike', $like))
                ->orderBy('name')
                ->limit(10)
                ->get(['id', 'name', 'address', 'status', 'is_partner', 'photo_url']),
            'courts' => DB::table('courts as c')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->join('sports as s', 's.id', '=', 'c.sport_id')
                ->where(fn ($q) => $q->where('c.name', 'ilike', $like)->orWhere('v.name', 'ilike', $like))
                ->orderBy('v.name')
                ->limit(10)
                ->get(['c.id', 'c.name', 'c.venue_id', 'v.name as venue_name', 's.slug as sport_slug', 'c.status']),
            'bookings' => DB::table('bookings as b')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->where(fn ($q) => $q->where('u.display_name', 'ilike', $like)->orWhere('u.email', 'ilike', $like)->orWhere('b.customer_name', 'ilike', $like)->orWhere('b.customer_email', 'ilike', $like)->orWhere('c.name', 'ilike', $like)->orWhere('v.name', 'ilike', $like))
                ->orderByDesc('b.created_at')
                ->limit(10)
                ->get(['b.id', 'b.starts_at', 'b.status', 'b.total_minor', 'b.currency', 'c.name as court_name', 'v.name as venue_name', 'u.display_name as booker_display_name', 'b.customer_name']),
        ]);
    }

    public function setRole(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        // Granting/revoking staff roles is admin-ONLY — a moderator (even with the
        // "users" permission) must not be able to escalate anyone to admin.
        $this->staff($request);
        $data = $this->validateBody($request, [
            'role' => ['nullable', 'in:admin,moderator'],
        ]);
        $oldRole = DB::table('users')->where('id', $id)->value('admin_role');
        DB::table('users')->where('id', $id)->update(['admin_role' => $data['role'] ?? null, 'updated_at' => now()]);
        $user = DB::table('users')->where('id', $id)->first();
        if ($user === null) {
            throw ApiException::notFound('User not found');
        }
        $this->auditWrite($admin->id, 'user.role', 'users', $id, [
            'old_role' => $oldRole,
            'new_role' => $data['role'] ?? null,
        ]);

        return response()->json($this->adminUserPayload((object) [
            ...((array) $user),
            'games_played_total' => DB::table('game_participants')->where('user_id', $id)->count(),
        ]));
    }

    public function user(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "users");
        $user = DB::table('users')->where('id', $id)->first();
        if ($user === null) {
            throw ApiException::notFound('User not found');
        }

        return response()->json([
            ...$this->adminUserPayload((object) [
                ...((array) $user),
                'games_played_total' => DB::table('game_participants')->where('user_id', $id)->count(),
            ]),
            'games_hosted_total' => DB::table('games')->where('host_user_id', $id)->count(),
            'bookings_total' => DB::table('bookings')->where('user_id', $id)->count(),
            'reports_filed_count' => DB::table('reports')->where('reporter_user_id', $id)->count(),
            'reports_received_count' => DB::table('reports')->where('target_kind', 'user')->where('target_id', $id)->count(),
            'suspended_at' => $this->iso($user->suspended_at ?? null),
            'suspension_reason' => $user->suspension_reason ?? null,
        ]);
    }

    public function suspendUser(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'reason' => ['required', 'string', 'min:2', 'max:2000'],
        ]);
        DB::table('users')->where('id', $id)->update([
            'suspended_at' => now(),
            'suspension_reason' => $data['reason'],
            'suspended_by_user_id' => $admin->id,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'user.suspend', 'users', $id, ['reason' => $data['reason']]);

        return $this->user($request, $id);
    }

    public function unsuspendUser(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        DB::table('users')->where('id', $id)->update([
            'suspended_at' => null,
            'suspension_reason' => null,
            'suspended_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'user.unsuspend', 'users', $id);

        return $this->user($request, $id);
    }

    public function setEmailVerification(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'verified' => ['required', 'boolean'],
        ]);
        $exists = DB::table('users')->where('id', $id)->exists();
        if (! $exists) {
            throw ApiException::notFound('User not found');
        }
        DB::table('users')->where('id', $id)->update([
            'email_verified_at' => $data['verified'] ? now() : null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, $data['verified'] ? 'user.email.verify' : 'user.email.unverify', 'users', $id);

        return $this->user($request, $id);
    }

    public function setVip(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'is_vip' => ['required', 'boolean'],
            'vip_badge_label' => ['sometimes', 'nullable', 'string', 'max:40'],
            'vip_expires_at' => ['sometimes', 'nullable', 'date'],
        ]);
        $exists = DB::table('users')->where('id', $id)->exists();
        if (! $exists) {
            throw ApiException::notFound('User not found');
        }

        $isVip = (bool) $data['is_vip'];
        DB::table('users')->where('id', $id)->update([
            'is_vip' => $isVip,
            'vip_badge_label' => $isVip ? trim((string) ($data['vip_badge_label'] ?? 'VIP')) : null,
            'vip_expires_at' => $isVip ? ($data['vip_expires_at'] ?? null) : null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, $isVip ? 'user.vip.enable' : 'user.vip.disable', 'users', $id, [
            'vip_badge_label' => $isVip ? ($data['vip_badge_label'] ?? 'VIP') : null,
            'vip_expires_at' => $isVip ? ($data['vip_expires_at'] ?? null) : null,
        ]);

        return $this->user($request, $id);
    }

    /**
     * Toggle the admin-granted "verified / official" badge (distinct from email
     * verification). Surfaces as a blue check next to the player everywhere.
     */
    public function setVerifiedBadge(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'is_verified' => ['required', 'boolean'],
        ]);
        $exists = DB::table('users')->where('id', $id)->exists();
        if (! $exists) {
            throw ApiException::notFound('User not found');
        }
        DB::table('users')->where('id', $id)->update([
            'is_verified' => (bool) $data['is_verified'],
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, $data['is_verified'] ? 'user.verified.enable' : 'user.verified.disable', 'users', $id);

        return $this->user($request, $id);
    }

    /**
     * Toggle the LinkFit brand "ambassador" designation. Shows as an ambassador
     * badge next to the player across the app and site.
     */
    public function setAmbassador(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'is_ambassador' => ['required', 'boolean'],
        ]);
        $exists = DB::table('users')->where('id', $id)->exists();
        if (! $exists) {
            throw ApiException::notFound('User not found');
        }
        DB::table('users')->where('id', $id)->update([
            'is_ambassador' => (bool) $data['is_ambassador'],
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, $data['is_ambassador'] ? 'user.ambassador.enable' : 'user.ambassador.disable', 'users', $id);

        return $this->user($request, $id);
    }

    /**
     * Set a user's membership tier (free / premium). A paid tier is
     * granted for `months` (default 1); 'free' clears the period.
     */
    public function setMembership(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'tier' => ['required', 'in:free,premium'],
            'months' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:36'],
        ]);
        if (! DB::table('users')->where('id', $id)->exists()) {
            throw ApiException::notFound('User not found');
        }

        $isPaid = $data['tier'] !== 'free';
        $months = (int) ($data['months'] ?? 1);
        $periodEnd = $isPaid ? now()->addMonths($months) : null;

        DB::table('memberships')->updateOrInsert(
            ['user_id' => $id],
            [
                'tier' => $data['tier'],
                'current_period_end' => $periodEnd,
                'cancel_at_period_end' => false,
                'payment_provider' => null,
                'provider_customer_id' => null,
                'provider_subscription_id' => null,
                'subscription_status' => $isPaid ? 'manual_grant' : null,
                'trial_ends_at' => null,
                'subscribed_at' => null,
                'updated_at' => now(),
            ],
        );
        $this->auditWrite($admin->id, $isPaid ? 'user.membership.grant' : 'user.membership.revoke', 'users', $id, [
            'tier' => $data['tier'],
            'months' => $isPaid ? $months : null,
        ]);

        return $this->user($request, $id);
    }

    public function softDelete(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        DB::table('users')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'user.soft_delete', 'users', $id);

        return response()->json(null, 204);
    }

    public function restore(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        DB::table('users')->where('id', $id)->update(['deleted_at' => null, 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'user.restore', 'users', $id);

        return response()->json(null, 204);
    }

    public function table(Request $request, string $table): JsonResponse
    {
        $this->staff($request, "operations");
        $allowed = ['games', 'venues', 'tournaments', 'bookings', 'audit_log'];
        if (! in_array($table, $allowed, true)) {
            throw ApiException::notFound('Admin resource not found');
        }

        return response()->json(['items' => DB::table($table)->orderByDesc('created_at')->limit(200)->get()]);
    }

    public function venues(Request $request): JsonResponse
    {
        $this->staff($request, "venues");

        $limit = min(max((int) $request->query('limit', 20), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $term = trim((string) $request->query('q', ''));
        $status = $request->query('status');
        $partner = $request->query('partner');
        $courtCounts = DB::table('courts')->selectRaw('venue_id, COUNT(*) as courts_count')->groupBy('venue_id');
        $bookingCounts = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->selectRaw('c.venue_id, COUNT(*) as bookings_count, SUM(CASE WHEN b.status = ? THEN b.total_minor ELSE 0 END) as paid_revenue_minor', ['paid'])
            ->groupBy('c.venue_id');

        $query = DB::table('venues as v')
            ->leftJoinSub($courtCounts, 'cc', 'cc.venue_id', '=', 'v.id')
            ->leftJoinSub($bookingCounts, 'bc', 'bc.venue_id', '=', 'v.id')
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(fn ($w) => $w->where('v.name', 'ilike', $like)->orWhere('v.address', 'ilike', $like));
            })
            ->when($status && $status !== 'all', fn ($q) => $q->where('v.status', $status))
            ->when($partner !== null && $partner !== 'all', fn ($q) => $q->where('v.is_partner', filter_var($partner, FILTER_VALIDATE_BOOLEAN)));

        $total = (clone $query)->count('v.id');
        $items = $query
            ->orderByDesc('v.created_at')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'v.*',
                DB::raw('COALESCE(cc.courts_count, 0) as courts_count'),
                DB::raw('COALESCE(bc.bookings_count, 0) as bookings_count'),
                DB::raw('COALESCE(bc.paid_revenue_minor, 0) as paid_revenue_minor'),
            ])
            ->map(fn ($venue) => $this->venuePayload($venue))
            ->values();

        return response()->json(['items' => $items, 'total' => $total, 'results' => $items, 'count' => $total]);
    }

    public function activity(Request $request): JsonResponse
    {
        $this->staff($request, "dashboard");
        $limit = min(max((int) $request->query('limit', 50), 1), 100);
        $audit = DB::table('audit_log as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
            ->orderByDesc('a.created_at')
            ->limit($limit)
            ->get(['a.id', 'a.actor_user_id', 'u.display_name as actor_display_name', 'a.action', 'a.entity', 'a.entity_id', 'a.metadata', 'a.created_at'])
            ->map(fn ($entry) => [
                'type' => 'audit',
                ...$this->auditPayload($entry),
            ]);
        $bookings = DB::table('bookings as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->orderByDesc('b.updated_at')
            ->limit($limit)
            ->get(['b.id', 'b.status', 'b.starts_at', 'b.updated_at', 'b.created_at', 'c.name as court_name', 'v.name as venue_name', 'u.display_name as booker_display_name', 'b.customer_name'])
            ->map(fn ($row) => [
                'type' => 'booking',
                'id' => (string) $row->id,
                'title' => trim(($row->booker_display_name ?: $row->customer_name ?: 'Manual booking').' - '.$row->venue_name.' / '.$row->court_name),
                'status' => (string) $row->status,
                'starts_at' => $this->iso($row->starts_at),
                'created_at' => $this->iso($row->created_at),
                'updated_at' => $this->iso($row->updated_at),
            ]);

        return response()->json([
            'items' => $audit->concat($bookings)->sortByDesc(fn ($item) => $item['updated_at'] ?? $item['created_at'])->take($limit)->values(),
        ]);
    }

    public function venue(Request $request, string $id): JsonResponse
    {
        $this->staffOrVenuePartner($request, $id);
        $venue = DB::table('venues')->where('id', $id)->first();
        if ($venue === null) {
            throw ApiException::notFound('Venue not found');
        }

        return response()->json([
            ...$this->venuePayload((object) [
                ...((array) $venue),
                'courts_count' => DB::table('courts')->where('venue_id', $id)->count(),
                'bookings_count' => DB::table('bookings as b')->join('courts as c', 'c.id', '=', 'b.court_id')->where('c.venue_id', $id)->count(),
                'paid_revenue_minor' => DB::table('bookings as b')->join('courts as c', 'c.id', '=', 'b.court_id')->where('c.venue_id', $id)->where('b.status', 'paid')->sum('b.total_minor'),
            ]),
            'courts' => DB::table('courts as c')
                ->join('sports as s', 's.id', '=', 'c.sport_id')
                ->where('c.venue_id', $id)
                ->whereIn('s.slug', ['padel', 'tennis'])
                ->orderBy('c.name')
                ->get(['c.*', 's.slug as sport_slug', 's.name as sport_name'])
                ->map(fn ($court) => $this->courtPayload($court))
                ->values(),
            'partners' => DB::table('users')->where('admin_role', 'partner')->where('venue_id', $id)->orderByDesc('created_at')->get(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'deleted_at', 'created_at']),
        ]);
    }

    public function games(Request $request): JsonResponse
    {
        $this->staff($request, "games");

        $limit = min(max((int) $request->query('limit', 20), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $term = trim((string) $request->query('q', ''));
        $status = $request->query('status');
        $sport = $request->query('sport');
        $from = $request->query('from');
        $to = $request->query('to');
        if ($sport && ! in_array((string) $sport, ['padel', 'tennis'], true)) {
            throw ApiException::validation('Unsupported sport');
        }

        $query = $this->adminGamesBaseQuery()
            ->whereNull('g.deleted_at')
            ->when($status, fn ($q) => $q->where('g.status', $status))
            ->when($sport, fn ($q) => $q->where('s.slug', $sport))
            ->when($from, fn ($q) => $q->where('g.starts_at', '>=', $from))
            ->when($to, fn ($q) => $q->where('g.starts_at', '<=', $to))
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(function ($qq) use ($like) {
                    $qq->where('u.display_name', 'ilike', $like)
                        ->orWhere('u.email', 'ilike', $like)
                        ->orWhere('v.name', 'ilike', $like)
                        ->orWhere('g.notes', 'ilike', $like);
                });
            });

        $total = (clone $query)->count('g.id');
        $items = $query
            ->orderByDesc('g.starts_at')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(fn ($game) => $this->adminGameRowPayload($game))
            ->values();

        return response()->json([
            'items' => $items,
            'total' => $total,
            'next_cursor' => null,
            'results' => $items,
            'count' => $total,
        ]);
    }

    public function tournaments(Request $request): JsonResponse
    {
        $this->staff($request, "tournaments");
        if ($request->query('sport') && ! in_array((string) $request->query('sport'), ['padel', 'tennis'], true)) {
            throw ApiException::validation('Unsupported sport');
        }
        $query = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->selectRaw('t.*, s.slug as sport_slug, s.name as sport_name, v.name as venue_name')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when($request->query('status'), fn ($q, $status) => $q->where('t.status', $status))
            ->when($request->query('sport'), fn ($q, $sport) => $q->where('s.slug', $sport))
            ->when($request->query('q'), fn ($q, $term) => $q->where('t.name', 'ilike', '%'.$term.'%'))
            ->orderByDesc('t.created_at');
        $limit = min(max((int) $request->query('limit', 50), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);

        $total = (clone $query)->count('t.id');
        $items = $query
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(fn ($t) => $this->tournamentPayload($t))
            ->values();

        return response()->json([
            'items' => $items,
            'total' => $total,
            'next_cursor' => null,
        ]);
    }

    public function bookings(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $partnerVenueId = null;
        if ($user->admin_role === 'partner') {
            if ($user->venue_id === null) {
                throw ApiException::validation('Partner user has no venue_id');
            }
            $partnerVenueId = (string) $user->venue_id;
        } else {
            $this->staff($request, "bookings");
        }

        $limit = min(max((int) $request->query('limit', 20), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $term = trim((string) $request->query('q', ''));
        $venueId = $request->query('venue_id');

        $query = DB::table('bookings as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->when($partnerVenueId !== null, fn ($q) => $q->where('v.id', $partnerVenueId))
            ->when($request->query('status'), fn ($q, $status) => $q->where('b.status', $status))
            ->when($partnerVenueId === null && $venueId, fn ($q) => $q->where('v.id', $venueId))
            ->when($request->query('court_id'), fn ($q, $courtId) => $q->where('c.id', $courtId))
            ->when($request->query('from'), fn ($q, $from) => $q->where('b.starts_at', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('b.starts_at', '<=', $to))
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(function ($qq) use ($like) {
                    $qq->where('u.display_name', 'ilike', $like)
                        ->orWhere('u.email', 'ilike', $like)
                        ->orWhere('v.name', 'ilike', $like)
                        ->orWhere('c.name', 'ilike', $like)
                        ->orWhere('b.external_ref', 'ilike', $like);
                });
            });

        $total = (clone $query)->count('b.id');
        $items = $query
            ->orderByDesc('b.created_at')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'b.id',
                'b.game_id',
                'b.court_id',
                'c.name as court_name',
                'b.user_id',
                'u.display_name as booker_display_name',
                'u.email as booker_email',
                'v.id as venue_id',
                'v.name as venue_name',
                'b.starts_at',
                'b.duration_minutes',
                'b.total_minor',
                'b.currency',
                'b.status',
                'b.source',
                'b.payment_method',
                'b.payment_note',
                'b.customer_name',
                'b.customer_email',
                'b.idempotency_key',
                'b.external_ref',
                'b.created_at',
                'b.paid_at',
                'b.cancelled_at',
                'b.cancelled_by_user_id',
                'b.cancellation_reason',
                'b.rescheduled_at',
                'b.no_show_at',
                'b.no_show_marked_by_user_id',
                'b.checked_in_at',
                'b.checked_in_by_user_id',
                'b.internal_note',
                'b.refund_status',
                'b.refund_amount_minor',
                'b.refund_note',
                'b.refunded_at',
            ])
            ->map(fn ($booking) => $this->bookingPayload($booking))
            ->values();

        return response()->json([
            'items' => $items,
            'total' => $total,
            'results' => $items,
            'count' => $total,
        ]);
    }

    public function exportBookings(Request $request)
    {
        $this->staff($request, "bookings");
        $from = $request->query('from');
        $to = $request->query('to');
        $venueId = $request->query('venue_id');
        $rows = DB::table('bookings as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->when($from, fn ($q) => $q->where('b.starts_at', '>=', $from))
            ->when($to, fn ($q) => $q->where('b.starts_at', '<=', $to))
            ->when($venueId, fn ($q) => $q->where('v.id', $venueId))
            ->orderBy('b.starts_at')
            ->get(['b.id', 'b.starts_at', 'b.duration_minutes', 'b.status', 'b.total_minor', 'b.currency', 'b.payment_method', 'b.customer_name', 'b.customer_email', 'v.name as venue_name', 'c.name as court_name', 'u.display_name as booker_display_name', 'u.email as booker_email']);
        $csv = "id,starts_at,duration_minutes,venue,court,status,payment_method,total_minor,currency,booker,booker_email,customer_name,customer_email\n";
        foreach ($rows as $row) {
            $csv .= implode(',', [
                $row->id,
                $row->starts_at,
                $row->duration_minutes,
                '"'.str_replace('"', '""', (string) $row->venue_name).'"',
                '"'.str_replace('"', '""', (string) $row->court_name).'"',
                $row->status,
                $row->payment_method,
                $row->total_minor,
                $row->currency,
                '"'.str_replace('"', '""', (string) $row->booker_display_name).'"',
                $row->booker_email,
                '"'.str_replace('"', '""', (string) $row->customer_name).'"',
                $row->customer_email,
            ])."\n";
        }

        return Response::make($csv, 200, ['Content-Type' => 'text/csv']);
    }

    public function calendar(Request $request): JsonResponse
    {
        $this->staff($request, "bookings");
        $from = CarbonImmutable::parse($request->query('from', now()->startOfWeek()->toIso8601String()));
        $to = CarbonImmutable::parse($request->query('to', now()->endOfWeek()->toIso8601String()));
        $venueId = $request->query('venue_id');
        $courtId = $request->query('court_id');

        return response()->json([
            'from' => $this->iso($from),
            'to' => $this->iso($to),
            'bookings' => DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->when($venueId, fn ($q) => $q->where('v.id', $venueId))
                ->when($courtId, fn ($q) => $q->where('c.id', $courtId))
                ->where('b.starts_at', '<=', $to)
                ->whereRaw("(b.starts_at + (b.duration_minutes || ' minutes')::interval) >= ?", [$from])
                ->orderBy('b.starts_at')
                ->limit(1000)
                ->get(['b.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name', 'u.display_name as booker_display_name', 'u.email as booker_email'])
                ->map(fn ($booking) => $this->bookingPayload($booking)),
            'blocks' => DB::table('court_blocks as cb')
                ->join('courts as c', 'c.id', '=', 'cb.court_id')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->when($venueId, fn ($q) => $q->where('v.id', $venueId))
                ->when($courtId, fn ($q) => $q->where('c.id', $courtId))
                ->where('cb.starts_at', '<=', $to)
                ->where('cb.ends_at', '>=', $from)
                ->orderBy('cb.starts_at')
                ->limit(1000)
                ->get(['cb.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']),
        ]);
    }

    public function revenue(Request $request)
    {
        $this->staff($request, "revenue");
        $from = $request->query('from');
        $to = $request->query('to');
        $venueId = $request->query('venue_id');
        $rows = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->when($from, fn ($q) => $q->where('b.starts_at', '>=', $from))
            ->when($to, fn ($q) => $q->where('b.starts_at', '<=', $to))
            ->when($venueId, fn ($q) => $q->where('v.id', $venueId))
            ->orderBy('b.starts_at')
            ->get(['b.id', 'b.starts_at', 'b.duration_minutes', 'b.total_minor', 'b.currency', 'b.status', 'b.payment_method', 'c.name as court_name', 'v.name as venue_name']);

        if ($request->query('format') === 'csv') {
            $csv = "id,starts_at,venue,court,status,payment_method,total_minor,currency\n";
            foreach ($rows as $row) {
                $csv .= implode(',', [
                    $row->id,
                    $row->starts_at,
                    '"'.str_replace('"', '""', (string) $row->venue_name).'"',
                    '"'.str_replace('"', '""', (string) $row->court_name).'"',
                    $row->status,
                    $row->payment_method,
                    $row->total_minor,
                    $row->currency,
                ])."\n";
            }

            return Response::make($csv, 200, ['Content-Type' => 'text/csv']);
        }

        return response()->json([
            'items' => $rows,
            'summary' => [
                'paid_total_minor' => (int) $rows->where('status', 'paid')->sum('total_minor'),
                'unpaid_total_minor' => (int) $rows->whereIn('status', ['pending_payment', 'partially_paid'])->sum('total_minor'),
                'cancelled_total_minor' => (int) $rows->where('status', 'cancelled')->sum('total_minor'),
                'bookings_count' => $rows->count(),
            ],
            'by_venue' => $rows->groupBy('venue_name')->map(fn ($group, $name) => [
                'venue_name' => $name,
                'bookings_count' => $group->count(),
                'paid_total_minor' => (int) $group->where('status', 'paid')->sum('total_minor'),
            ])->values(),
        ]);
    }

    public function booking(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "bookings");

        return response()->json($this->bookingPayload($this->bookingRow($id)));
    }

    public function bulkUpdateBookings(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "bookings");
        $data = $this->validateBody($request, [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['uuid'],
            'status' => ['required', 'in:pending_payment,partially_paid,paid,cancelled,refunded,failed'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
            'payment_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'cancellation_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'refund_status' => ['sometimes', 'nullable', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $updates = [
            'status' => $data['status'],
            'updated_at' => now(),
        ];
        if ($data['status'] === 'paid') {
            $updates['paid_at'] = now();
        }
        if ($data['status'] === 'cancelled') {
            $updates['cancelled_at'] = now();
            $updates['cancelled_by_user_id'] = $admin->id;
        }
        if ($data['status'] === 'refunded') {
            $updates['refund_status'] = $data['refund_status'] ?? 'processed';
            $updates['refunded_at'] = now();
        }
        if (array_key_exists('payment_method', $data)) {
            $updates['payment_method'] = $data['payment_method'];
        }
        if (array_key_exists('payment_note', $data)) {
            $updates['payment_note'] = $data['payment_note'];
        }
        foreach (['cancellation_reason', 'refund_status', 'refund_amount_minor', 'refund_note'] as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }

        $affected = DB::table('bookings')->whereIn('id', $data['ids'])->update($updates);
        $this->auditWrite($admin->id, 'booking.bulk_update', 'bookings', null, ['ids' => $data['ids'], 'updates' => $updates, 'affected' => $affected]);

        return response()->json(['updated' => $affected]);
    }

    public function createBooking(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "bookings");
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'user_id' => ['sometimes', 'nullable', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'customer_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'customer_email' => ['sometimes', 'nullable', 'email', 'max:254'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
            'payment_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'status' => ['sometimes', 'in:pending_payment,paid'],
        ]);
        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $data['court_id'])
            ->first(['c.*', 'v.opening_hours', 'v.booking_slot_minutes', 'v.min_booking_minutes', 'v.max_booking_minutes']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }
        if (! empty($data['user_id']) && ! DB::table('users')->where('id', $data['user_id'])->whereNull('deleted_at')->exists()) {
            throw ApiException::validation('Unknown user_id');
        }
        $starts = CarbonImmutable::parse($data['starts_at']);
        $duration = (int) $data['duration_minutes'];
        $this->assertVenueRules($court, $starts, $duration);
        $this->assertBookingSlotAvailable((string) $data['court_id'], $starts, $starts->addMinutes($duration));

        $id = (string) Str::uuid();
        $status = $data['status'] ?? 'pending_payment';
        DB::table('bookings')->insert([
            'id' => $id,
            'game_id' => null,
            'court_id' => $data['court_id'],
            'user_id' => $data['user_id'] ?? $admin->id,
            'starts_at' => $starts,
            'duration_minutes' => $duration,
            'total_minor' => $this->bookingTotalMinor($court, $duration),
            'currency' => $court->currency,
            'status' => $status,
            'source' => 'admin_manual',
            'payment_method' => $data['payment_method'] ?? 'manual',
            'payment_note' => $data['payment_note'] ?? null,
            'customer_name' => $data['customer_name'] ?? null,
            'customer_email' => $data['customer_email'] ?? null,
            'created_by_user_id' => $admin->id,
            'idempotency_key' => 'admin:'.$id,
            'paid_at' => $status === 'paid' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app(TransactionalMailService::class)->bookingConfirmed($id);
        $this->auditWrite($admin->id, 'booking.create', 'bookings', $id, ['source' => 'admin_manual']);

        return $this->booking($request, $id);
    }

    public function quoteBooking(Request $request): JsonResponse
    {
        $this->staff($request, "bookings");
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
        ]);
        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $data['court_id'])
            ->first(['c.*', 'v.id as venue_id', 'v.name as venue_name', 'v.opening_hours', 'v.booking_slot_minutes', 'v.min_booking_minutes', 'v.max_booking_minutes']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }
        $starts = CarbonImmutable::parse($data['starts_at']);
        $duration = (int) $data['duration_minutes'];
        $this->assertVenueRules($court, $starts, $duration);
        $this->assertBookingSlotAvailable((string) $data['court_id'], $starts, $starts->addMinutes($duration));

        return response()->json([
            'court_id' => $data['court_id'],
            'venue_id' => $court->venue_id,
            'venue_name' => $court->venue_name,
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $starts->addMinutes($duration)->toIso8601ZuluString('millisecond'),
            'duration_minutes' => $duration,
            'hourly_price_minor' => (int) $court->hourly_price_minor,
            'total_minor' => $this->bookingTotalMinor($court, $duration),
            'currency' => $court->currency,
            'available' => true,
        ]);
    }

    public function updateBooking(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "bookings");
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
            'status' => ['sometimes', 'in:pending_payment,partially_paid,paid,cancelled,refunded,failed'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
            'payment_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'customer_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'customer_email' => ['sometimes', 'nullable', 'email', 'max:254'],
            'internal_note' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'cancellation_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'refund_status' => ['sometimes', 'nullable', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $starts = array_key_exists('starts_at', $data) ? CarbonImmutable::parse($data['starts_at']) : CarbonImmutable::parse($booking->starts_at);
        $duration = (int) ($data['duration_minutes'] ?? $booking->duration_minutes);
        if (array_key_exists('starts_at', $data) || array_key_exists('duration_minutes', $data)) {
            $this->assertBookingSlotAvailable((string) $booking->court_id, $starts, $starts->addMinutes($duration), $id);
            $data['starts_at'] = $starts;
            $data['duration_minutes'] = $duration;
            $court = DB::table('courts')->where('id', $booking->court_id)->first();
            if ($court !== null) {
                $data['total_minor'] = $this->bookingTotalMinor($court, $duration);
            }
            $data['rescheduled_at'] = now();
            if ($booking->user_id !== null) {
                $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking rescheduled', 'Your booking time was updated.', ['booking_id' => $id, 'starts_at' => $starts->toIso8601String()]);
            }
        }
        if (($data['status'] ?? null) === 'paid') {
            $data['paid_at'] = now();
        }
        if (($data['status'] ?? null) === 'cancelled') {
            $data['cancelled_at'] = now();
            $data['cancelled_by_user_id'] = $admin->id;
            if ($booking->user_id !== null) {
                $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking cancelled', 'Your booking was cancelled.', ['booking_id' => $id]);
            }
        }
        if (($data['status'] ?? null) === 'refunded') {
            $data['refund_status'] = $data['refund_status'] ?? 'processed';
            $data['refunded_at'] = now();
        }
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        DB::table('bookings')->where('id', $id)->update([...$data, 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'booking.update', 'bookings', $id, $data);

        return $this->booking($request, $id);
    }

    public function markBookingNoShow(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "bookings");
        DB::table('bookings')->where('id', $id)->update([
            'no_show_at' => now(),
            'no_show_marked_by_user_id' => $admin->id,
            'checked_in_at' => null,
            'checked_in_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking !== null && $booking->user_id !== null) {
            $this->enqueueNotification((string) $booking->user_id, 'no_show_marked', 'No-show marked', 'Your booking was marked as no-show.', ['booking_id' => $id]);
        }
        $this->auditWrite($admin->id, 'booking.no_show', 'bookings', $id);

        return $this->booking($request, $id);
    }

    public function clearBookingNoShow(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "bookings");
        DB::table('bookings')->where('id', $id)->update([
            'no_show_at' => null,
            'no_show_marked_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'booking.no_show_clear', 'bookings', $id);

        return $this->booking($request, $id);
    }

    public function checkInBooking(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrBookingPartner($request, $id);
        DB::table('bookings')->where('id', $id)->update([
            'checked_in_at' => now(),
            'checked_in_by_user_id' => $admin->id,
            'no_show_at' => null,
            'no_show_marked_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'booking.check_in', 'bookings', $id);

        return $this->booking($request, $id);
    }

    public function undoCheckInBooking(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrBookingPartner($request, $id);
        DB::table('bookings')->where('id', $id)->update([
            'checked_in_at' => null,
            'checked_in_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'booking.check_in_undo', 'bookings', $id);

        return $this->booking($request, $id);
    }

    public function audit(Request $request): JsonResponse
    {
        $this->staff($request, "operations");

        $limit = min(max((int) $request->query('limit', 50), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $query = $this->auditQuery($request);
        $total = (clone $query)->count('a.id');
        $items = $query
            ->orderByDesc('a.created_at')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'a.id',
                'a.actor_user_id',
                'u.display_name as actor_display_name',
                'a.action',
                'a.entity',
                'a.entity_id',
                'a.metadata',
                'a.created_at',
            ])
            ->map(fn ($entry) => $this->auditPayload($entry))
            ->values();

        return response()->json(['items' => $items, 'total' => $total]);
    }

    public function exportAudit(Request $request)
    {
        $this->staff($request, "operations");
        $rows = $this->auditQuery($request)
            ->orderByDesc('a.created_at')
            ->limit(5000)
            ->get([
                'a.id',
                'a.actor_user_id',
                'u.display_name as actor_display_name',
                'u.email as actor_email',
                'a.action',
                'a.entity',
                'a.entity_id',
                'a.metadata',
                'a.created_at',
            ]);

        return Response::streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['id', 'created_at', 'actor_user_id', 'actor_name', 'actor_email', 'action', 'entity', 'entity_id', 'metadata']);
            foreach ($rows as $row) {
                fputcsv($out, [
                    $row->id,
                    $this->iso($row->created_at),
                    $row->actor_user_id,
                    $row->actor_display_name,
                    $row->actor_email,
                    $row->action,
                    $row->entity,
                    $row->entity_id,
                    json_encode($this->metadataPayload($row->metadata)),
                ]);
            }
            fclose($out);
        }, 'linkfit-audit.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function createAlert(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "operations");
        $data = $this->validateBody($request, [
            'title' => ['required', 'string', 'min:2', 'max:120'],
            'body' => ['required', 'string', 'min:2', 'max:1000'],
            'severity' => ['sometimes', 'in:info,warning,critical'],
            'target_role' => ['sometimes', 'in:admins,partners,all'],
        ]);

        $severity = (string) ($data['severity'] ?? 'critical');
        $targetRole = (string) ($data['target_role'] ?? 'admins');
        $users = DB::table('users')
            ->whereNull('deleted_at')
            ->when($targetRole === 'admins', fn ($q) => $q->whereIn('admin_role', ['admin', 'moderator']))
            ->when($targetRole === 'partners', fn ($q) => $q->where('admin_role', 'partner'))
            ->when($targetRole === 'all', fn ($q) => $q->whereNotNull('admin_role'))
            ->get(['id', 'email']);

        $now = now();
        $payload = [
            'kind' => 'admin_alert',
            'severity' => $severity,
            'target_role' => $targetRole,
            'created_by_user_id' => $admin->id,
        ];
        $notifications = [];
        $jobs = [];
        foreach ($users as $user) {
            $notifications[] = [
                'id' => (string) Str::uuid(),
                'user_id' => $user->id,
                'type' => 'system',
                'title' => $data['title'],
                'body' => $data['body'],
                'payload' => json_encode($payload),
                'created_at' => $now,
            ];
            $jobs[] = [
                'id' => (string) Str::uuid(),
                'user_id' => $user->id,
                'type' => 'system',
                'title' => $data['title'],
                'body' => $data['body'],
                'payload' => json_encode($payload),
                'status' => 'pending',
                'available_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        app(TransactionalMailService::class)->criticalAlert(
            $data['title'],
            $data['body'],
            $users->pluck('email')->filter()->all(),
            $targetRole === 'partners',
        );
        if ($notifications !== []) {
            DB::table('notifications')->insert($notifications);
            DB::table('push_notification_jobs')->insert($jobs);
        }
        $this->auditWrite($admin->id, 'admin.alert.create', 'notifications', null, [
            'severity' => $severity,
            'target_role' => $targetRole,
            'recipient_count' => count($notifications),
        ]);

        return response()->json([
            'recipient_count' => count($notifications),
            'severity' => $severity,
            'target_role' => $targetRole,
        ], 201);
    }

    public function notifications(Request $request): JsonResponse
    {
        $this->staff($request, "operations");
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:200'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'user_id' => ['nullable', 'uuid'],
            'type' => ['nullable', 'in:booking_reminder,game_invite,game_update,tournament_invite,message_received,system'],
            'read' => ['nullable', 'in:true,false,1,0'],
            'severity' => ['nullable', 'in:info,warning,critical'],
            'q' => ['nullable', 'string', 'max:120'],
        ]);

        $base = DB::table('notifications as n')
            ->leftJoin('users as u', 'u.id', '=', 'n.user_id');

        if (! empty($query['user_id'])) {
            $base->where('n.user_id', $query['user_id']);
        }
        if (! empty($query['type'])) {
            $base->where('n.type', $query['type']);
        }
        if (array_key_exists('read', $query)) {
            in_array((string) $query['read'], ['true', '1'], true)
                ? $base->whereNotNull('n.read_at')
                : $base->whereNull('n.read_at');
        }
        if (! empty($query['severity'])) {
            $base->whereRaw("n.payload->>'severity' = ?", [$query['severity']]);
        }
        if (! empty($query['q'])) {
            $needle = '%'.mb_strtolower($query['q']).'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(n.title) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(n.body) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(u.email, \'\')) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(u.display_name, \'\')) LIKE ?', [$needle]);
            });
        }

        $total = (clone $base)->count('n.id');
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);
        $items = $base
            ->orderByDesc('n.created_at')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'n.*',
                'u.email as user_email',
                'u.display_name as user_display_name',
                'u.photo_url as user_photo_url',
            ])
            ->map(fn ($notification) => $this->adminNotificationPayload($notification))
            ->values();

        return response()->json([
            'items' => $items,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
            'summary' => [
                'unread' => DB::table('notifications')->whereNull('read_at')->count(),
                'system' => DB::table('notifications')->where('type', 'system')->count(),
                'critical' => DB::table('notifications')->whereRaw("payload->>'severity' = ?", ['critical'])->count(),
            ],
        ]);
    }

    public function notification(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "operations");

        return response()->json($this->adminNotificationPayload($this->notificationRow($id)));
    }

    public function sendNotification(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "operations");
        $data = $this->validateBody($request, [
            'title' => ['required', 'string', 'min:2', 'max:120'],
            'body' => ['required', 'string', 'min:2', 'max:1000'],
            'type' => ['sometimes', 'in:booking_reminder,game_invite,game_update,tournament_invite,message_received,system'],
            'severity' => ['sometimes', 'in:info,warning,critical'],
            'target_role' => ['sometimes', 'in:admins,partners,customers,all'],
            'user_ids' => ['sometimes', 'array', 'min:1', 'max:200'],
            'user_ids.*' => ['uuid'],
            'metadata' => ['sometimes', 'array'],
        ]);

        $recipients = $this->notificationRecipients($data);
        if ($recipients->isEmpty()) {
            throw ApiException::validation('No notification recipients found');
        }

        $now = now();
        $type = (string) ($data['type'] ?? 'system');
        $payload = [
            'kind' => 'admin_notification',
            'severity' => $data['severity'] ?? 'info',
            'target_role' => $data['target_role'] ?? null,
            'created_by_user_id' => $admin->id,
            'metadata' => $data['metadata'] ?? [],
        ];
        $notifications = [];
        $jobs = [];
        foreach ($recipients as $recipient) {
            $notifications[] = [
                'id' => (string) Str::uuid(),
                'user_id' => $recipient->id,
                'type' => $type,
                'title' => $data['title'],
                'body' => $data['body'],
                'payload' => json_encode($payload),
                'created_at' => $now,
            ];
            $jobs[] = [
                'id' => (string) Str::uuid(),
                'user_id' => $recipient->id,
                'type' => $type,
                'title' => $data['title'],
                'body' => $data['body'],
                'payload' => json_encode($payload),
                'status' => 'pending',
                'available_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        DB::table('notifications')->insert($notifications);
        if (Schema::hasTable('push_notification_jobs')) {
            DB::table('push_notification_jobs')->insert($jobs);
        }
        $this->auditWrite($admin->id, 'admin.notification.send', 'notifications', null, [
            'type' => $type,
            'severity' => $payload['severity'],
            'target_role' => $payload['target_role'],
            'recipient_count' => count($notifications),
        ]);

        return response()->json([
            'recipient_count' => count($notifications),
            'type' => $type,
            'severity' => $payload['severity'],
        ], 201);
    }

    public function markNotificationRead(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "operations");
        $this->notificationRow($id);

        DB::table('notifications')->where('id', $id)->update(['read_at' => now()]);
        $this->auditWrite($admin->id, 'admin.notification.read', 'notifications', $id);

        return response()->json($this->adminNotificationPayload($this->notificationRow($id)));
    }

    public function markNotificationUnread(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "operations");
        $this->notificationRow($id);

        DB::table('notifications')->where('id', $id)->update(['read_at' => null]);
        $this->auditWrite($admin->id, 'admin.notification.unread', 'notifications', $id);

        return response()->json($this->adminNotificationPayload($this->notificationRow($id)));
    }

    public function deleteNotification(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "operations");
        $this->notificationRow($id);

        DB::table('notifications')->where('id', $id)->delete();
        $this->auditWrite($admin->id, 'admin.notification.delete', 'notifications', $id);

        return response()->json(['ok' => true]);
    }

    public function game(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "games");
        $game = $this->adminGameById($id);

        return response()->json($this->adminGameDetailPayload($game));
    }

    public function cancelGame(Request $request, string $id): JsonResponse
    {
        $admin = $this->staff($request, "games");
        $this->adminGameById($id);
        DB::table('games')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'admin.game.cancel', 'games', $id);

        return response()->json(null, 204);
    }

    public function updateGame(Request $request, string $id): JsonResponse
    {
        $admin = $this->staff($request, "games");
        $game = $this->adminGameById($id);
        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:360'],
            'status' => ['sometimes', 'in:open,full,cancelled,completed'],
            'capacity' => ['sometimes', 'integer', 'min:1', 'max:200'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'skill_min_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:5000'],
            'skill_max_elo' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:5000'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        $skillMin = array_key_exists('skill_min_elo', $data) ? $data['skill_min_elo'] : $game->skill_min_elo;
        $skillMax = array_key_exists('skill_max_elo', $data) ? $data['skill_max_elo'] : $game->skill_max_elo;
        if ($skillMin !== null && $skillMax !== null && (int) $skillMin > (int) $skillMax) {
            throw ApiException::validation('skill_min_elo must be <= skill_max_elo');
        }
        $updated = DB::table('games')->where('id', $id)->update([...$data, 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Game not found');
        }
        $this->auditWrite($admin->id, 'admin.game.update', 'games', $id, [
            'fields' => array_keys($data),
        ]);

        return response()->json($this->adminGameDetailPayload($this->adminGameById($id)));
    }

    public function createTournament(Request $request): JsonResponse
    {
        $this->staff($request, "tournaments");
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'sport_id' => ['required', 'uuid'],
            'venue_id' => ['sometimes', 'nullable', 'uuid'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date'],
            'registration_deadline' => ['sometimes', 'nullable', 'date'],
            'max_squads' => ['required', 'integer', 'min:2', 'max:256'],
            'squad_size' => ['required', 'integer', 'min:1', 'max:20'],
            'entry_fee_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'status' => ['sometimes', 'in:announced,registration_open,registration_closed,in_progress,completed,cancelled'],
        ]);
        if (! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        if (($data['venue_id'] ?? null) !== null && ! DB::table('venues')->where('id', $data['venue_id'])->exists()) {
            throw ApiException::validation('Unknown venue_id');
        }
        $this->assertTournamentDateWindow($data);
        $id = (string) Str::uuid();
        DB::table('tournaments')->insert([
            'id' => $id,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'sport_id' => $data['sport_id'],
            'venue_id' => $data['venue_id'] ?? null,
            'starts_at' => $data['starts_at'],
            'ends_at' => $data['ends_at'],
            'registration_deadline' => $data['registration_deadline'] ?? null,
            'max_squads' => $data['max_squads'],
            'squad_size' => $data['squad_size'],
            'entry_fee_minor' => $data['entry_fee_minor'] ?? 0,
            'currency' => strtoupper($data['currency'] ?? 'AZN'),
            'status' => $data['status'] ?? 'announced',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($this->authUser($request)->id, 'admin.tournament.create', 'tournaments', $id, [
            'name' => $data['name'],
            'venue_id' => $data['venue_id'] ?? null,
            'status' => $data['status'] ?? 'announced',
        ]);

        return response()->json($this->tournamentById($id), 201);
    }

    public function tournament(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "tournaments");

        return response()->json([
            ...$this->tournamentById($id),
            'entries' => $this->tournamentEntriesPayload($id),
        ]);
    }

    public function updateTournament(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "tournaments");
        $existing = $this->adminTournamentRowById($id);
        $data = $this->validateBody($request, [
            'name' => ['sometimes', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'sport_id' => ['sometimes', 'uuid'],
            'venue_id' => ['sometimes', 'nullable', 'uuid'],
            'starts_at' => ['sometimes', 'date'],
            'ends_at' => ['sometimes', 'date'],
            'registration_deadline' => ['sometimes', 'nullable', 'date'],
            'max_squads' => ['sometimes', 'integer', 'min:2', 'max:256'],
            'squad_size' => ['sometimes', 'integer', 'min:1', 'max:20'],
            'entry_fee_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'status' => ['sometimes', 'in:announced,registration_open,registration_closed,in_progress,completed,cancelled'],
        ]);
        if (isset($data['currency'])) {
            $data['currency'] = strtoupper($data['currency']);
        }
        if (isset($data['sport_id']) && ! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        if (array_key_exists('venue_id', $data) && $data['venue_id'] !== null && ! DB::table('venues')->where('id', $data['venue_id'])->exists()) {
            throw ApiException::validation('Unknown venue_id');
        }
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        $this->assertTournamentDateWindow($data, $existing);
        $updated = DB::table('tournaments')->where('id', $id)->update([...$data, 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'admin.tournament.update', 'tournaments', $id, [
            'fields' => array_keys($data),
        ]);

        return response()->json($this->tournamentById($id));
    }

    public function deleteTournament(Request $request, string $id): JsonResponse
    {
        $admin = $this->staff($request, "tournaments");
        $this->adminTournamentRowById($id);
        $updated = DB::table('tournaments')->where('id', $id)->update(['status' => 'cancelled', 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament not found');
        }
        $this->auditWrite($admin->id, 'admin.tournament.cancel', 'tournaments', $id);

        return response()->json(null, 204);
    }

    public function tournamentEntries(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "tournaments");

        return response()->json([
            'items' => $this->tournamentEntriesPayload($id),
        ]);
    }

    public function updateTournamentEntry(Request $request, string $id, string $entryId): JsonResponse
    {
        $this->staff($request, "tournaments");
        $this->tournamentById($id);
        $data = $this->validateBody($request, [
            'status' => ['required', 'in:pending,confirmed,withdrawn,disqualified'],
        ]);

        $updated = DB::table('tournament_entries')
            ->where('tournament_id', $id)
            ->where('id', $entryId)
            ->update(['status' => $data['status']]);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament entry not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'admin.tournament_entry.update', 'tournament_entries', $entryId, [
            'tournament_id' => $id,
            'status' => $data['status'],
        ]);

        $entry = DB::table('tournament_entries as e')
            ->join('users as u', 'u.id', '=', 'e.captain_user_id')
            ->where('e.id', $entryId)
            ->first(['e.*', 'u.display_name as captain_display_name', 'u.photo_url as captain_photo_url', 'u.email as captain_email']);

        return response()->json($this->tournamentEntryPayload($entry));
    }

    public function removeTournamentEntry(Request $request, string $id, string $entryId): JsonResponse
    {
        $this->staff($request, "tournaments");
        $updated = DB::table('tournament_entries')
            ->where('tournament_id', $id)
            ->where('id', $entryId)
            ->update(['status' => 'withdrawn']);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament entry not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'admin.tournament_entry.withdraw', 'tournament_entries', $entryId, [
            'tournament_id' => $id,
        ]);

        return response()->json(null, 204);
    }

    public function deleteGame(Request $request, string $id): JsonResponse
    {
        $admin = $this->staff($request, "games");
        $this->adminGameById($id);
        DB::table('games')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'admin.game.delete', 'games', $id);

        return response()->json(null, 204);
    }

    public function createVenue(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:1', 'max:160'],
            'address' => ['required', 'string', 'min:1', 'max:500'],
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'is_partner' => ['sometimes', 'boolean'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:80'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'photo_urls' => ['sometimes', 'nullable', 'array'],
            'photo_urls.*' => ['string', 'url', 'max:2048'],
            'status' => ['sometimes', 'in:draft,pending,published,suspended'],
            'opening_hours' => ['sometimes', 'nullable', 'array'],
            'booking_slot_minutes' => ['sometimes', 'integer', 'min:5', 'max:240'],
            'min_booking_minutes' => ['sometimes', 'integer', 'min:5', 'max:1440'],
            'max_booking_minutes' => ['sometimes', 'integer', 'min:5', 'max:1440'],
            'cancellation_window_minutes' => ['sometimes', 'integer', 'min:0', 'max:43200'],
        ]);
        $id = (string) Str::uuid();
        $payload = [
            'id' => $id,
            'name' => trim((string) $data['name']),
            'address' => trim((string) $data['address']),
            'lat' => $data['lat'],
            'lng' => $data['lng'],
            'is_partner' => (bool) ($data['is_partner'] ?? false),
            'phone' => isset($data['phone']) ? trim((string) $data['phone']) : null,
            'description' => $data['description'] ?? null,
            'photo_url' => $data['photo_url'] ?? null,
            'status' => $data['status'] ?? 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ];
        foreach (['booking_slot_minutes', 'min_booking_minutes', 'max_booking_minutes', 'cancellation_window_minutes'] as $field) {
            if (array_key_exists($field, $data)) {
                $payload[$field] = $data[$field];
            }
        }
        if (array_key_exists('opening_hours', $data)) {
            $payload['opening_hours'] = $data['opening_hours'] !== null ? json_encode($data['opening_hours']) : null;
        }
        if (array_key_exists('photo_urls', $data)) {
            $payload['photo_urls'] = $this->pgTextArrayLiteral($data['photo_urls']);
        }
        DB::table('venues')->insert($payload);
        $this->auditWrite($admin->id, 'venue.create', 'venues', $id, [
            'name' => $payload['name'] ?? null,
            'is_partner' => $payload['is_partner'] ?? false,
        ]);

        return response()->json($this->venuePayload(DB::table('venues')->where('id', $id)->first()), 201);
    }

    public function globalCourts(Request $request): JsonResponse
    {
        $this->staff($request, "courts");
        $limit = min(max((int) $request->query('limit', 50), 1), 200);
        $term = trim((string) $request->query('q', ''));
        $venueId = $request->query('venue_id');
        $sport = $request->query('sport');
        $status = $request->query('status');
        if ($sport && ! in_array((string) $sport, ['padel', 'tennis'], true)) {
            throw ApiException::validation('Unsupported sport');
        }
        $items = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when($venueId, fn ($q) => $q->where('v.id', $venueId))
            ->when($sport, fn ($q) => $q->where('s.slug', $sport))
            ->when($status && $status !== 'all', fn ($q) => $q->where('c.status', $status))
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(fn ($w) => $w->where('c.name', 'ilike', $like)->orWhere('v.name', 'ilike', $like));
            })
            ->orderBy('v.name')
            ->orderBy('c.name')
            ->limit($limit)
            ->get(['c.*', 's.slug as sport_slug', 's.name as sport_name', 'v.name as venue_name'])
            ->map(fn ($court) => $this->courtPayload($court))
            ->values();

        return response()->json(['items' => $items]);
    }

    public function court(Request $request, string $courtId): JsonResponse
    {
        $this->staff($request, "courts");
        $court = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $courtId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['c.*', 's.slug as sport_slug', 's.name as sport_name', 'v.name as venue_name']);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        return response()->json([
            ...$this->courtPayload($court),
            'upcoming_bookings_count' => DB::table('bookings')->where('court_id', $courtId)->where('starts_at', '>=', now())->whereNotIn('status', ['cancelled', 'refunded', 'failed'])->count(),
            'active_blocks_count' => DB::table('court_blocks')->where('court_id', $courtId)->where('ends_at', '>=', now())->count(),
            'recent_bookings' => DB::table('bookings as b')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->where('b.court_id', $courtId)
                ->orderByDesc('b.starts_at')
                ->limit(20)
                ->get(['b.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name', 'u.display_name as booker_display_name', 'u.email as booker_email'])
                ->map(fn ($booking) => $this->bookingPayload($booking)),
        ]);
    }

    public function updateVenue(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        $updates = $this->validateBody($request, [
            'name' => ['sometimes', 'string', 'min:1', 'max:160'],
            'address' => ['sometimes', 'string', 'min:1', 'max:500'],
            'lat' => ['sometimes', 'numeric', 'between:-90,90'],
            'lng' => ['sometimes', 'numeric', 'between:-180,180'],
            'is_partner' => ['sometimes', 'boolean'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:80'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'photo_urls' => ['sometimes', 'nullable', 'array'],
            'photo_urls.*' => ['string', 'url', 'max:2048'],
            'opening_hours' => ['sometimes', 'nullable', 'array'],
            'booking_slot_minutes' => ['sometimes', 'integer', 'min:5', 'max:240'],
            'min_booking_minutes' => ['sometimes', 'integer', 'min:5', 'max:1440'],
            'max_booking_minutes' => ['sometimes', 'integer', 'min:5', 'max:1440'],
            'cancellation_window_minutes' => ['sometimes', 'integer', 'min:0', 'max:43200'],
        ]);
        if ($updates === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        foreach (['name', 'address', 'phone'] as $field) {
            if (isset($updates[$field])) {
                $updates[$field] = trim((string) $updates[$field]);
            }
        }
        if (array_key_exists('opening_hours', $updates) && is_array($updates['opening_hours'])) {
            $updates['opening_hours'] = json_encode($updates['opening_hours']);
        }
        if (array_key_exists('photo_urls', $updates)) {
            $updates['photo_urls'] = $this->pgTextArrayLiteral(is_array($updates['photo_urls']) ? $updates['photo_urls'] : null);
        }
        $updated = DB::table('venues')->where('id', $id)->update([...$updates, 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Venue not found');
        }
        $this->auditWrite($admin->id, 'venue.update', 'venues', $id, [
            'fields' => array_keys($updates),
        ]);

        return response()->json($this->venuePayload(DB::table('venues')->where('id', $id)->first()));
    }

    public function updateVenueStatus(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        $data = $this->validateBody($request, [
            'status' => ['required', 'in:draft,pending,published,suspended'],
        ]);
        $updated = DB::table('venues')->where('id', $id)->update([
            'status' => $data['status'],
            'approved_at' => $data['status'] === 'published' ? now() : null,
            'approved_by_user_id' => $data['status'] === 'published' ? $admin->id : null,
            'updated_at' => now(),
        ]);
        if ($updated === 0) {
            throw ApiException::notFound('Venue not found');
        }
        $this->auditWrite($admin->id, 'venue.status', 'venues', $id, $data);

        return response()->json(DB::table('venues')->where('id', $id)->first());
    }

    public function deleteVenue(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        if (! DB::table('venues')->where('id', $id)->exists()) {
            throw ApiException::notFound('Venue not found');
        }
        if (
            DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->where('c.venue_id', $id)
                ->exists()
        ) {
            throw ApiException::conflict('Venue has bookings and cannot be deleted');
        }
        DB::table('venues')->where('id', $id)->delete();
        $this->auditWrite($admin->id, 'venue.delete', 'venues', $id);

        return response()->json(null, 204);
    }

    public function courts(Request $request, string $id): JsonResponse
    {
        $this->staffOrVenuePartner($request, $id);

        return response()->json([
            'items' => DB::table('courts as c')
                ->join('sports as s', 's.id', '=', 'c.sport_id')
                ->where('c.venue_id', $id)
                ->whereIn('s.slug', ['padel', 'tennis'])
                ->orderBy('c.name')
                ->get(['c.*', 's.slug as sport_slug'])
                ->map(fn ($court) => $this->courtPayload($court))
                ->values(),
        ]);
    }

    public function createCourt(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrVenuePartner($request, $id);
        $data = $this->validateBody($request, [
            'sport_id' => ['required', 'uuid'],
            'name' => ['required', 'string', 'min:1', 'max:120'],
            'hourly_price_minor' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'currency' => ['nullable', 'string', 'size:3'],
            'status' => ['nullable', 'in:active,inactive,maintenance'],
            'photo_url' => ['nullable', 'url', 'max:2048'],
            'photo_urls' => ['nullable', 'array'],
        ]);
        if (! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        $courtId = (string) Str::uuid();
        DB::table('courts')->insert([
            'id' => $courtId,
            'venue_id' => $id,
            'sport_id' => $data['sport_id'],
            'name' => $data['name'],
            'hourly_price_minor' => $data['hourly_price_minor'] ?? 0,
            'currency' => $data['currency'] ?? 'AZN',
            'status' => $data['status'] ?? 'active',
            'photo_url' => $data['photo_url'] ?? null,
            'photo_urls' => isset($data['photo_urls']) ? json_encode($data['photo_urls']) : null,
            'created_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'court.create', 'courts', $courtId, [
            'venue_id' => $id,
            'sport_id' => $data['sport_id'],
            'name' => $data['name'],
        ]);

        return response()->json($this->courtById($courtId), 201);
    }

    public function updateCourt(Request $request, string $id, string $courtId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrVenuePartner($request, $id);
        $data = $this->validateBody($request, [
            'sport_id' => ['sometimes', 'uuid'],
            'name' => ['sometimes', 'string', 'min:1', 'max:120'],
            'hourly_price_minor' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'status' => ['sometimes', 'in:active,inactive,maintenance'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'photo_urls' => ['sometimes', 'nullable', 'array'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        if (array_key_exists('photo_urls', $data)) {
            $data['photo_urls'] = $data['photo_urls'] !== null ? json_encode($data['photo_urls']) : null;
        }
        if (isset($data['sport_id']) && ! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        $updated = DB::table('courts')->where('venue_id', $id)->where('id', $courtId)->update($data);
        if ($updated === 0) {
            throw ApiException::notFound('Court not found');
        }
        $this->auditWrite($admin->id, 'court.update', 'courts', $courtId, [
            'venue_id' => $id,
            'fields' => array_keys($data),
        ]);

        return response()->json($this->courtByVenueId($id, $courtId));
    }

    public function deleteCourt(Request $request, string $id, string $courtId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrVenuePartner($request, $id);
        if (! DB::table('courts')->where('venue_id', $id)->where('id', $courtId)->exists()) {
            throw ApiException::notFound('Court not found');
        }
        if (DB::table('bookings')->where('court_id', $courtId)->exists()) {
            throw ApiException::conflict('Court has bookings and cannot be deleted');
        }
        $deleted = DB::table('courts')->where('venue_id', $id)->where('id', $courtId)->delete();
        if ($deleted === 0) {
            throw ApiException::notFound('Court not found');
        }
        $this->auditWrite($admin->id, 'court.delete', 'courts', $courtId, [
            'venue_id' => $id,
        ]);

        return response()->json(null, 204);
    }

    public function courtBlocks(Request $request, string $courtId): JsonResponse
    {
        $this->staff($request, "courts");

        return response()->json(['items' => DB::table('court_blocks')->where('court_id', $courtId)->orderByDesc('starts_at')->get()]);
    }

    public function createCourtBlock(Request $request, string $courtId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "courts");
        if (! DB::table('courts')->where('id', $courtId)->exists()) {
            throw ApiException::notFound('Court not found');
        }
        $data = $this->validateBody($request, [
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date'],
            'reason' => ['nullable', 'string', 'max:160'],
        ]);
        $starts = CarbonImmutable::parse($data['starts_at']);
        $ends = CarbonImmutable::parse($data['ends_at']);
        if ($ends <= $starts) {
            throw ApiException::validation('ends_at must be after starts_at');
        }
        if (! (bool) $request->input('force', false) && DB::table('bookings')->where('court_id', $courtId)->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])->where('starts_at', '<', $ends)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()) {
            throw ApiException::conflict('Court has bookings in this maintenance window');
        }
        $id = (string) Str::uuid();
        DB::table('court_blocks')->insert([
            'id' => $id,
            'court_id' => $courtId,
            'created_by_user_id' => $admin->id,
            'starts_at' => $starts,
            'ends_at' => $ends,
            'reason' => $data['reason'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'court.block.create', 'court_blocks', $id, ['court_id' => $courtId]);

        return response()->json(DB::table('court_blocks')->where('id', $id)->first(), 201);
    }

    public function deleteCourtBlock(Request $request, string $courtId, string $blockId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "courts");
        DB::table('court_blocks')->where('court_id', $courtId)->where('id', $blockId)->delete();
        $this->auditWrite($admin->id, 'court.block.delete', 'court_blocks', $blockId, ['court_id' => $courtId]);

        return response()->json(null, 204);
    }

    public function updateCourtBlock(Request $request, string $courtId, string $blockId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "courts");
        $block = DB::table('court_blocks')->where('court_id', $courtId)->where('id', $blockId)->first();
        if ($block === null) {
            throw ApiException::notFound('Block not found');
        }
        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'ends_at' => ['sometimes', 'date'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:160'],
            'force' => ['sometimes', 'boolean'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        $starts = array_key_exists('starts_at', $data) ? CarbonImmutable::parse($data['starts_at']) : CarbonImmutable::parse($block->starts_at);
        $ends = array_key_exists('ends_at', $data) ? CarbonImmutable::parse($data['ends_at']) : CarbonImmutable::parse($block->ends_at);
        if ($ends <= $starts) {
            throw ApiException::validation('ends_at must be after starts_at');
        }
        if (! (bool) ($data['force'] ?? false) && DB::table('bookings')->where('court_id', $courtId)->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])->where('starts_at', '<', $ends)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()) {
            throw ApiException::conflict('Court has bookings in this maintenance window');
        }
        $updates = [
            'starts_at' => $starts,
            'ends_at' => $ends,
            'updated_at' => now(),
        ];
        if (array_key_exists('reason', $data)) {
            $updates['reason'] = $data['reason'];
        }
        DB::table('court_blocks')->where('id', $blockId)->update($updates);
        $this->auditWrite($admin->id, 'court.block.update', 'court_blocks', $blockId, ['court_id' => $courtId]);

        return response()->json(DB::table('court_blocks')->where('id', $blockId)->first());
    }

    public function markPaid(Request $request, string $id): JsonResponse
    {
        $this->staffOrBookingPartner($request, $id);
        if (! DB::table('bookings')->where('id', $id)->exists()) {
            throw ApiException::notFound('Booking not found');
        }
        DB::table('bookings')->where('id', $id)->update(['status' => 'paid', 'paid_at' => now(), 'updated_at' => now()]);
        $this->auditWrite($this->authUser($request)->id, 'booking.mark_paid', 'bookings', $id);

        return response()->json(['ok' => true]);
    }

    public function moderationReports(Request $request): JsonResponse
    {
        $this->staff($request, "reports");

        return response()->json(['reports' => DB::table('reports')->orderByDesc('created_at')->limit(200)->get(), 'total' => DB::table('reports')->count(), 'next_cursor' => null]);
    }

    public function reviewModerationReport(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "reports");
        $data = $this->validateBody($request, [
            'action' => ['sometimes', 'in:dismiss,review'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $action = $data['action'] ?? 'dismiss';
        $updated = DB::table('reports')->where('id', $id)->update([
            'status' => $action === 'dismiss' ? 'dismissed' : 'reviewed',
            'notes' => $data['notes'] ?? null,
            'reviewed_by_user_id' => $admin->id,
            'reviewed_at' => now(),
        ]);
        if ($updated === 0) {
            throw ApiException::notFound('Report not found');
        }
        $this->auditWrite($admin->id, 'report.review', 'reports', $id, ['action' => $action]);

        return response()->json(DB::table('reports')->where('id', $id)->first());
    }

    public function moderationUser(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "reports");
        $user = DB::table('users')->where('id', $id)->first();
        if ($user === null) {
            throw ApiException::notFound('User not found');
        }

        return response()->json([
            ...((array) $user),
            'games_played_total' => DB::table('game_participants')->where('user_id', $id)->count(),
            'games_hosted_total' => DB::table('games')->where('host_user_id', $id)->count(),
            'reports_filed_count' => DB::table('reports')->where('reporter_user_id', $id)->count(),
            'reports_received_count' => DB::table('reports')->where('target_kind', 'user')->where('target_id', $id)->count(),
            'recent_reports_filed' => DB::table('reports')->where('reporter_user_id', $id)->orderByDesc('created_at')->limit(10)->get(),
            'recent_reports_received' => DB::table('reports')->where('target_kind', 'user')->where('target_id', $id)->orderByDesc('created_at')->limit(10)->get(),
        ]);
    }

    public function deactivateUser(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "reports");
        if (! DB::table('users')->where('id', $id)->exists()) {
            throw ApiException::notFound('User not found');
        }
        DB::table('users')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'user.deactivate', 'users', $id);

        return response()->json(null, 204);
    }

    public function deletions(Request $request): JsonResponse
    {
        $this->staff($request, "operations");

        return response()->json(['items' => DB::table('account_deletion_requests')->where('status', 'scheduled')->orderBy('hard_delete_at')->limit(200)->get()]);
    }

    public function cancelDeletion(Request $request, string $userId): JsonResponse
    {
        $admin = $this->staff($request, "operations");
        $updated = DB::table('account_deletion_requests')
            ->where('user_id', $userId)
            ->where('status', 'scheduled')
            ->update(['status' => 'cancelled', 'cancelled_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Scheduled deletion request not found');
        }
        $this->auditWrite($admin->id, 'account_deletion.cancel', 'account_deletion_requests', $userId);

        return response()->json(null, 204);
    }

    public function exports(Request $request): JsonResponse
    {
        $this->staff($request, "operations");

        return response()->json(['items' => DB::table('data_export_requests')->orderByDesc('created_at')->limit(200)->get()]);
    }

    public function operations(Request $request): JsonResponse
    {
        $this->staff($request, "operations");
        $now = now();
        $apnsKeyPath = (string) config('services.apns.private_key_path');

        return response()->json([
            'generated_at' => $now->toIso8601String(),
            'apns' => [
                'configured' => config('services.apns.key_id') !== null
                    && config('services.apns.team_id') !== null
                    && config('services.apns.bundle_id') !== null
                    && $apnsKeyPath !== ''
                    && is_readable($apnsKeyPath),
                'production' => (bool) config('services.apns.production'),
                'bundle_id_set' => config('services.apns.bundle_id') !== null,
                'key_id_set' => config('services.apns.key_id') !== null,
                'team_id_set' => config('services.apns.team_id') !== null,
                'private_key_readable' => $apnsKeyPath !== '' && is_readable($apnsKeyPath),
            ],
            'push_queue' => [
                'pending' => DB::table('push_notification_jobs')->where('status', 'pending')->count(),
                'retry' => DB::table('push_notification_jobs')->where('status', 'retry')->count(),
                'processing' => DB::table('push_notification_jobs')->where('status', 'processing')->count(),
                'deferred' => DB::table('push_notification_jobs')->whereIn('status', ['pending', 'retry'])->where('available_at', '>', $now)->count(),
                'sent_24h' => DB::table('push_notification_jobs')->where('status', 'sent')->where('sent_at', '>=', $now->copy()->subDay())->count(),
                'failed' => DB::table('push_notification_jobs')->where('status', 'failed')->count(),
                'cancelled' => DB::table('push_notification_jobs')->where('status', 'cancelled')->count(),
                'skipped' => DB::table('push_notification_jobs')->where('status', 'skipped')->count(),
                'oldest_pending_at' => $this->iso(DB::table('push_notification_jobs')->whereIn('status', ['pending', 'retry'])->min('created_at')),
            ],
            'reminders' => [
                'games_sent_24h' => DB::table('game_reminders_sent')->where('sent_at', '>=', $now->copy()->subDay())->count(),
                'bookings_sent_24h' => DB::table('booking_reminders_sent')->where('sent_at', '>=', $now->copy()->subDay())->count(),
                'games_due_next_2h' => DB::table('games as g')
                    ->join('game_participants as gp', 'gp.game_id', '=', 'g.id')
                    ->leftJoin('game_reminders_sent as grs', function ($join) {
                        $join->on('grs.game_id', '=', 'g.id')->on('grs.user_id', '=', 'gp.user_id');
                    })
                    ->whereNull('grs.game_id')
                    ->whereIn('g.status', ['open', 'full'])
                    ->where('gp.status', 'confirmed')
                    ->whereBetween('g.starts_at', [$now, $now->copy()->addHours(2)])
                    ->count(),
                'bookings_due_next_2h' => DB::table('bookings as b')
                    ->leftJoin('booking_reminders_sent as brs', function ($join) {
                        $join->on('brs.booking_id', '=', 'b.id')->on('brs.user_id', '=', 'b.user_id');
                    })
                    ->whereNull('brs.booking_id')
                    ->whereNotNull('b.user_id')
                    ->whereIn('b.status', ['pending_payment', 'partially_paid', 'paid'])
                    ->whereBetween('b.starts_at', [$now, $now->copy()->addHours(2)])
                    ->count(),
            ],
            'media' => [
                'disk' => env('MEDIA_DISK', config('filesystems.default') === 's3' ? 's3' : 'public'),
                'assets_total' => DB::table('media_assets')->count(),
                'deleted_pending_cleanup' => DB::table('media_assets')->whereNotNull('deleted_at')->whereNull('cleanup_reason')->count(),
                'bytes_total' => (int) DB::table('media_assets')->whereNull('deleted_at')->sum('size_bytes'),
            ],
            'timers' => [
                'expected' => [
                    'linkfit-push-process.timer' => 'every 60 seconds',
                    'linkfit-reminders.timer' => 'every 5 minutes',
                ],
            ],
        ]);
    }

    public function pushJobs(Request $request): JsonResponse
    {
        $this->staff($request, "push_jobs");
        $limit = min(max((int) $request->query('limit', 50), 1), 200);
        $status = $request->query('status');
        $userId = $request->query('user_id');
        $items = DB::table('push_notification_jobs as p')
            ->leftJoin('users as u', 'u.id', '=', 'p.user_id')
            ->when($status, fn ($q) => $q->where('p.status', $status))
            ->when($userId, fn ($q) => $q->where('p.user_id', $userId))
            ->orderByDesc('p.created_at')
            ->limit($limit)
            ->get([
                'p.*',
                'u.email as user_email',
                'u.display_name as user_display_name',
            ]);

        return response()->json([
            'items' => $items,
            'summary' => [
                'pending' => DB::table('push_notification_jobs')->where('status', 'pending')->count(),
                'retry' => DB::table('push_notification_jobs')->where('status', 'retry')->count(),
                'processing' => DB::table('push_notification_jobs')->where('status', 'processing')->count(),
                'deferred' => DB::table('push_notification_jobs')->whereIn('status', ['pending', 'retry'])->where('available_at', '>', now())->count(),
                'sent_24h' => DB::table('push_notification_jobs')->where('status', 'sent')->where('sent_at', '>=', now()->subDay())->count(),
                'failed' => DB::table('push_notification_jobs')->where('status', 'failed')->count(),
                'cancelled' => DB::table('push_notification_jobs')->where('status', 'cancelled')->count(),
                'skipped' => DB::table('push_notification_jobs')->where('status', 'skipped')->count(),
            ],
        ]);
    }

    public function retryPushJob(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "push_jobs");
        DB::table('push_notification_jobs')->where('id', $id)->update([
            'status' => 'pending',
            'available_at' => now(),
            'error' => null,
            'provider_response' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'push_job.retry', 'push_notification_jobs', $id);

        return response()->json(DB::table('push_notification_jobs')->where('id', $id)->first());
    }

    public function cancelPushJob(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "push_jobs");
        DB::table('push_notification_jobs')->where('id', $id)->whereIn('status', ['pending', 'retry', 'processing'])->update([
            'status' => 'cancelled',
            'error' => 'Cancelled by admin',
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'push_job.cancel', 'push_notification_jobs', $id);

        return response()->json(DB::table('push_notification_jobs')->where('id', $id)->first());
    }

    public function media(Request $request): JsonResponse
    {
        $this->staff($request, "media");
        $limit = min(max((int) $request->query('limit', 50), 1), 100);

        return response()->json([
            'items' => DB::table('media_assets')->orderByDesc('created_at')->limit($limit)->get(),
        ]);
    }

    public function deleteMedia(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "media");
        $asset = DB::table('media_assets')->where('id', $id)->first();
        if ($asset === null) {
            throw ApiException::notFound('Media asset not found');
        }
        Storage::disk($asset->disk)->delete($asset->path);
        DB::table('media_assets')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'media.delete', 'media_assets', $id);

        return response()->json(null, 204);
    }

    public function cleanupMedia(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "media");
        $data = $this->validateBody($request, [
            'older_than_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
            'dry_run' => ['nullable', 'boolean'],
            'purpose' => ['nullable', 'string', 'max:64'],
        ]);

        $cutoff = now()->subDays((int) ($data['older_than_days'] ?? 7));
        $limit = (int) ($data['limit'] ?? 100);
        $dryRun = (bool) ($data['dry_run'] ?? false);
        $query = DB::table('media_assets')
            ->whereNotNull('deleted_at')
            ->where('deleted_at', '<=', $cutoff)
            ->when($data['purpose'] ?? null, fn ($q, $purpose) => $q->where('purpose', $purpose))
            ->orderBy('deleted_at')
            ->limit($limit);

        $assets = $query->get(['id', 'disk', 'path']);
        $deleted = 0;
        $errors = [];
        if (! $dryRun) {
            foreach ($assets as $asset) {
                try {
                    Storage::disk($asset->disk)->delete($asset->path);
                    DB::table('media_assets')->where('id', $asset->id)->update([
                        'cleanup_reason' => 'deleted_asset_pruned',
                        'updated_at' => now(),
                    ]);
                    $deleted++;
                } catch (\Throwable $e) {
                    $errors[] = ['id' => $asset->id, 'error' => $e->getMessage()];
                }
            }
            $this->auditWrite($admin->id, 'media.cleanup', 'media_assets', null, [
                'selected' => $assets->count(),
                'deleted' => $deleted,
                'errors' => count($errors),
                'older_than_days' => (int) ($data['older_than_days'] ?? 7),
            ]);
        }

        return response()->json([
            'selected' => $assets->count(),
            'deleted' => $deleted,
            'dry_run' => $dryRun,
            'errors' => $errors,
        ]);
    }

    public function cancelBooking(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrBookingPartner($request, $id);
        $data = $this->validateBody($request, [
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'refund_status' => ['sometimes', 'nullable', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $booking = DB::table('bookings')->where('id', $id)->first();
        $updates = [
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancelled_by_user_id' => $admin->id,
            'cancellation_reason' => $data['reason'] ?? null,
            'updated_at' => now(),
        ];
        foreach (['refund_status', 'refund_amount_minor', 'refund_note'] as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }
        DB::table('bookings')->where('id', $id)->update($updates);
        if ($booking !== null && $booking->user_id !== null) {
            $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking cancelled', 'Your booking was cancelled.', ['booking_id' => $id]);
        }
        app(TransactionalMailService::class)->bookingCancelled($id, $updates['cancellation_reason'] ?? null);
        $this->auditWrite($admin->id, 'booking.cancel', 'bookings', $id, $updates);

        return response()->json($this->bookingPayload($this->bookingRow($id)));
    }

    public function refundBooking(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staffOrBookingPartner($request, $id);
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        $data = $this->validateBody($request, [
            'refund_status' => ['sometimes', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $refundStatus = $data['refund_status'] ?? 'processed';
        $updates = [
            'refund_status' => $refundStatus,
            'refund_amount_minor' => array_key_exists('refund_amount_minor', $data) ? $data['refund_amount_minor'] : (int) $booking->total_minor,
            'refund_note' => $data['refund_note'] ?? null,
            'updated_at' => now(),
        ];
        if ($refundStatus === 'processed') {
            $updates['status'] = 'refunded';
            $updates['refunded_at'] = now();
        }
        DB::table('bookings')->where('id', $id)->update($updates);
        if ($booking->user_id !== null) {
            $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking refund updated', 'Your booking refund status was updated.', ['booking_id' => $id, 'refund_status' => $refundStatus]);
        }
        app(TransactionalMailService::class)->bookingRefundUpdated($id);
        $this->auditWrite($admin->id, 'booking.refund', 'bookings', $id, $updates);

        return response()->json($this->bookingPayload($this->bookingRow($id)));
    }

    public function partnerAccounts(Request $request, string $id): JsonResponse
    {
        $this->staff($request, "venues");
        $this->ensureVenueExists($id);

        return response()->json([
            'items' => DB::table('users')
                ->where('admin_role', 'partner')
                ->where('venue_id', $id)
                ->orderByDesc('created_at')
                ->get(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at'])
                ->map(fn ($user) => $this->partnerAccountPayload($user))
                ->values(),
        ]);
    }

    public function createUser(Request $request): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "users");
        $data = $this->validateBody($request, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'display_name' => ['required', 'string', 'min:1', 'max:80'],
            'password' => ['required', 'string', 'min:12', 'max:200'],
            'admin_role' => ['sometimes', 'nullable', 'in:admin,moderator'],
            'email_verified' => ['sometimes', 'boolean'],
        ]);
        // Granting an admin/moderator role at creation is a privilege action —
        // require full admin, so a moderator with only the "users" permission
        // can't mint a staff account (matches the setRole hardening).
        if (! empty($data['admin_role'])) {
            $this->staff($request);
        }
        $email = mb_strtolower(trim($data['email']));
        $displayName = trim($data['display_name']);
        $this->assertPasswordPolicy($data['password']);
        if (DB::table('users')->where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }

        $userId = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $userId,
            'email' => $email,
            'password_hash' => app(PasswordService::class)->hash($data['password']),
            'display_name' => $displayName,
            'admin_role' => $data['admin_role'] ?? null,
            'email_verified_at' => ! empty($data['email_verified']) ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'user.create', 'users', $userId, [
            'email' => $email,
            'admin_role' => $data['admin_role'] ?? null,
        ]);

        return response()->json([
            'id' => $userId,
            'email' => $email,
            'display_name' => $displayName,
            'admin_role' => $data['admin_role'] ?? null,
            'created_at' => $this->iso(now()),
        ], 201);
    }

    public function createPartnerAccount(Request $request, string $id): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        $this->ensureVenueExists($id);
        $data = $this->validateBody($request, [
            'email' => ['required', 'string', 'email', 'max:254'],
            'display_name' => ['required', 'string', 'min:1', 'max:80'],
            'password' => ['required', 'string', 'min:12', 'max:200'],
            'staff_title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'staff_permissions' => ['sometimes', 'nullable', 'array'],
        ]);
        $email = mb_strtolower(trim($data['email']));
        $displayName = trim($data['display_name']);
        $this->assertPasswordPolicy($data['password']);
        if (DB::table('users')->where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }

        $userId = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $userId,
            'email' => $email,
            'password_hash' => app(PasswordService::class)->hash($data['password']),
            'display_name' => $displayName,
            'admin_role' => 'partner',
            'venue_id' => $id,
            'staff_title' => isset($data['staff_title']) ? trim((string) $data['staff_title']) : 'Venue owner',
            'staff_permissions' => json_encode($this->normalizePartnerPermissions($data['staff_permissions'] ?? null, true)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('venues')->where('id', $id)->update(['is_partner' => true, 'updated_at' => now()]);
        DB::table('venues')->where('id', $id)->whereNull('owner_user_id')->update(['owner_user_id' => $userId, 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'partner_account.create', 'users', $userId, [
            'venue_id' => $id,
            'email' => $email,
        ]);

        return response()->json($this->partnerAccountById($id, $userId), 201);
    }

    public function updatePartnerAccount(Request $request, string $id, string $userId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        $this->ensureVenueExists($id);
        $data = $this->validateBody($request, [
            'email' => ['sometimes', 'string', 'email', 'max:254'],
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'password' => ['sometimes', 'string', 'min:12', 'max:200'],
            'staff_title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'staff_permissions' => ['sometimes', 'nullable', 'array'],
            'restore' => ['sometimes', 'boolean'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }

        $updates = ['updated_at' => now()];
        if (isset($data['email'])) {
            $email = mb_strtolower(trim($data['email']));
            $exists = DB::table('users')->where('email', $email)->where('id', '!=', $userId)->exists();
            if ($exists) {
                throw ApiException::conflict('Email is already registered');
            }
            $updates['email'] = $email;
        }
        if (isset($data['display_name'])) {
            $updates['display_name'] = trim($data['display_name']);
        }
        if (isset($data['password'])) {
            $this->assertPasswordPolicy($data['password']);
            $updates['password_hash'] = app(PasswordService::class)->hash($data['password']);
        }
        if (array_key_exists('staff_title', $data)) {
            $updates['staff_title'] = $data['staff_title'] !== null ? trim($data['staff_title']) : null;
        }
        if (array_key_exists('staff_permissions', $data)) {
            $updates['staff_permissions'] = json_encode($this->normalizePartnerPermissions($data['staff_permissions']));
        }
        if (array_key_exists('restore', $data) && $data['restore'] === true) {
            $updates['deleted_at'] = null;
        }

        $updated = DB::table('users')
            ->where('id', $userId)
            ->where('admin_role', 'partner')
            ->where('venue_id', $id)
            ->update($updates);
        if ($updated === 0) {
            throw ApiException::notFound('Partner account not found');
        }
        $this->auditWrite($admin->id, 'partner_account.update', 'users', $userId, [
            'venue_id' => $id,
            'fields' => array_values(array_diff(array_keys($updates), ['password_hash'])),
        ]);

        return response()->json($this->partnerAccountById($id, $userId));
    }

    public function deletePartnerAccount(Request $request, string $id, string $userId): JsonResponse
    {
        $admin = $this->authUser($request);
        $this->staff($request, "venues");
        $updated = DB::table('users')
            ->where('id', $userId)
            ->where('admin_role', 'partner')
            ->where('venue_id', $id)
            ->update(['deleted_at' => now(), 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Partner account not found');
        }
        $this->auditWrite($admin->id, 'partner_account.delete', 'users', $userId, [
            'venue_id' => $id,
        ]);

        return response()->json(null, 204);
    }

    private function adminUserPayload(object $u): array
    {
        return [
            'id' => (string) $u->id,
            'username' => $u->username ?? null,
            'email' => (string) $u->email,
            'display_name' => (string) $u->display_name,
            'admin_role' => $u->admin_role,
            'venue_id' => isset($u->venue_id) ? (string) $u->venue_id : null,
            'deleted_at' => $this->iso($u->deleted_at),
            'created_at' => $this->iso($u->created_at),
            'updated_at' => $this->iso($u->updated_at ?? null),
            'email_verified_at' => $this->iso($u->email_verified_at ?? null),
            'email_is_verified' => ($u->email_verified_at ?? null) !== null,
            'suspended_at' => $this->iso($u->suspended_at ?? null),
            'suspension_reason' => $u->suspension_reason ?? null,
            'suspended_by_user_id' => isset($u->suspended_by_user_id) ? (string) $u->suspended_by_user_id : null,
            'last_seen_at' => $this->iso($u->last_seen_at ?? null),
            'is_vip' => (bool) ($u->is_vip ?? false),
            'vip_badge_label' => $u->vip_badge_label ?? null,
            'vip_expires_at' => $this->iso($u->vip_expires_at ?? null),
            'is_verified' => (bool) ($u->is_verified ?? false),
            'is_ambassador' => (bool) ($u->is_ambassador ?? false),
            'membership_tier' => ($m = app(\App\Services\Membership\MembershipService::class)->resolve((string) $u->id, isset($u->created_at) ? (string) $u->created_at : null))->tier,
            'is_premium' => $m->is_premium,
            'on_trial' => $m->on_trial,
            'membership_period_end' => $this->iso($m->current_period_end),
            'games_played_total' => (int) ($u->games_played_total ?? 0),
        ];
    }

    private function adminGamesBaseQuery()
    {
        $participants = DB::table('game_participants')
            ->selectRaw('game_id, COUNT(*) as participants_count')
            ->whereIn('status', ['confirmed', 'played', 'no_show'])
            ->groupBy('game_id');

        return DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->join('users as u', 'u.id', '=', 'g.host_user_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoinSub($participants, 'pc', 'pc.game_id', '=', 'g.id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->selectRaw('
                g.*,
                s.slug as sport_slug,
                u.display_name as host_display_name,
                u.photo_url as host_photo_url,
                v.id as venue_id,
                v.name as venue_name,
                COALESCE(pc.participants_count, 0) as participants_count
            ');
    }

    private function adminGameById(string $id): object
    {
        $game = $this->adminGamesBaseQuery()->where('g.id', $id)->first();
        if ($game === null) {
            throw ApiException::notFound('Game not found');
        }

        return $game;
    }

    private function adminGameRowPayload(object $g): array
    {
        return [
            'id' => (string) $g->id,
            'sport_id' => (string) $g->sport_id,
            'sport_slug' => (string) $g->sport_slug,
            'host_user_id' => (string) $g->host_user_id,
            'host_display_name' => (string) $g->host_display_name,
            'host_photo_url' => $g->host_photo_url,
            'venue_id' => $g->venue_id ? (string) $g->venue_id : null,
            'venue_name' => $g->venue_name,
            'lat' => (float) $g->lat,
            'lng' => (float) $g->lng,
            'starts_at' => $this->iso($g->starts_at),
            'duration_minutes' => (int) $g->duration_minutes,
            'capacity' => (int) $g->capacity,
            'participants_count' => (int) $g->participants_count,
            'status' => $this->gameStatus((string) $g->status),
            'visibility' => $g->visibility === 'public' ? 'public' : 'invite',
            'skill_min_elo' => $g->skill_min_elo === null ? null : (int) $g->skill_min_elo,
            'skill_max_elo' => $g->skill_max_elo === null ? null : (int) $g->skill_max_elo,
            'created_at' => $this->iso($g->created_at),
            'deleted_at' => $this->iso($g->deleted_at),
        ];
    }

    private function adminGameDetailPayload(object $g): array
    {
        $participants = DB::table('game_participants as gp')
            ->join('users as u', 'u.id', '=', 'gp.user_id')
            ->where('gp.game_id', $g->id)
            ->orderBy('gp.joined_at')
            ->get([
                'gp.user_id',
                'u.display_name',
                'u.photo_url',
                'gp.status',
                'gp.joined_at',
                'gp.status_changed_at',
            ])
            ->map(fn ($p) => [
                'user_id' => (string) $p->user_id,
                'display_name' => (string) $p->display_name,
                'photo_url' => $p->photo_url,
                'status' => (string) $p->status,
                'joined_at' => $this->iso($p->joined_at),
                'status_changed_at' => $this->iso($p->status_changed_at ?? $p->joined_at),
            ])
            ->values();

        $statusChanges = DB::table('audit_log as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
            ->where('a.entity', 'game')
            ->where('a.entity_id', $g->id)
            ->orderByDesc('a.created_at')
            ->limit(50)
            ->get([
                'a.id',
                'a.actor_user_id',
                'u.display_name as actor_display_name',
                'a.action',
                'a.metadata',
                'a.created_at',
            ])
            ->map(fn ($entry) => [
                'id' => (string) $entry->id,
                'actor_user_id' => $entry->actor_user_id ? (string) $entry->actor_user_id : null,
                'actor_display_name' => $entry->actor_display_name,
                'action' => (string) $entry->action,
                'metadata' => $this->metadataPayload($entry->metadata),
                'created_at' => $this->iso($entry->created_at),
            ])
            ->values();

        return [
            ...$this->adminGameRowPayload($g),
            'notes' => $g->notes,
            'updated_at' => $this->iso($g->updated_at),
            'participants' => $participants,
            'status_changes' => $statusChanges,
        ];
    }

    private function gameStatus(string $status): string
    {
        return in_array($status, ['open', 'full', 'cancelled', 'completed'], true) ? $status : 'open';
    }

    private function bookingPayload(object $b): array
    {
        return [
            'id' => (string) $b->id,
            'game_id' => $b->game_id ? (string) $b->game_id : null,
            'court_id' => (string) $b->court_id,
            'court_name' => (string) $b->court_name,
            'user_id' => (string) $b->user_id,
            'booker_display_name' => (string) ($b->booker_display_name ?? 'Deleted user'),
            'booker_email' => (string) ($b->booker_email ?? ''),
            'venue_id' => (string) $b->venue_id,
            'venue_name' => (string) $b->venue_name,
            'starts_at' => $this->iso($b->starts_at),
            'duration_minutes' => (int) $b->duration_minutes,
            'total_minor' => (int) $b->total_minor,
            'currency' => trim((string) $b->currency),
            'status' => (string) $b->status,
            'source' => (string) ($b->source ?? 'app'),
            'payment_method' => $b->payment_method ?? null,
            'payment_note' => $b->payment_note ?? null,
            'customer_name' => $b->customer_name ?? null,
            'customer_email' => $b->customer_email ?? null,
            'idempotency_key' => (string) $b->idempotency_key,
            'external_ref' => $b->external_ref,
            'created_at' => $this->iso($b->created_at),
            'paid_at' => $this->iso($b->paid_at),
            'cancelled_at' => $this->iso($b->cancelled_at),
            'cancelled_by_user_id' => $b->cancelled_by_user_id ?? null,
            'cancellation_reason' => $b->cancellation_reason ?? null,
            'rescheduled_at' => $this->iso($b->rescheduled_at ?? null),
            'no_show_at' => $this->iso($b->no_show_at ?? null),
            'no_show_marked_by_user_id' => $b->no_show_marked_by_user_id ?? null,
            'checked_in_at' => $this->iso($b->checked_in_at ?? null),
            'checked_in_by_user_id' => $b->checked_in_by_user_id ?? null,
            'internal_note' => $b->internal_note ?? null,
            'refund_status' => $b->refund_status ?? null,
            'refund_amount_minor' => $b->refund_amount_minor ?? null,
            'refund_note' => $b->refund_note ?? null,
            'refunded_at' => $this->iso($b->refunded_at ?? null),
        ];
    }

    private function bookingRow(string $id): object
    {
        $booking = DB::table('bookings as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('b.id', $id)
            ->first([
                'b.id',
                'b.game_id',
                'b.court_id',
                'c.name as court_name',
                'b.user_id',
                'u.display_name as booker_display_name',
                'u.email as booker_email',
                'v.id as venue_id',
                'v.name as venue_name',
                'b.starts_at',
                'b.duration_minutes',
                'b.total_minor',
                'b.currency',
                'b.status',
                'b.source',
                'b.payment_method',
                'b.payment_note',
                'b.customer_name',
                'b.customer_email',
                'b.idempotency_key',
                'b.external_ref',
                'b.created_at',
                'b.paid_at',
                'b.cancelled_at',
                'b.cancelled_by_user_id',
                'b.cancellation_reason',
                'b.rescheduled_at',
                'b.no_show_at',
                'b.no_show_marked_by_user_id',
                'b.checked_in_at',
                'b.checked_in_by_user_id',
                'b.internal_note',
                'b.refund_status',
                'b.refund_amount_minor',
                'b.refund_note',
                'b.refunded_at',
            ]);
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }

        return $booking;
    }

    private function assertBookingSlotAvailable(string $courtId, CarbonImmutable $starts, CarbonImmutable $ends, ?string $ignoreBookingId = null): void
    {
        $overlap = DB::table('bookings')
            ->where('court_id', $courtId)
            ->when($ignoreBookingId, fn ($q) => $q->where('id', '!=', $ignoreBookingId))
            ->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])
            ->where('starts_at', '<', $ends)
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])
            ->exists();
        if ($overlap) {
            throw ApiException::conflict('Court is already booked for this time');
        }
        $blocked = DB::table('court_blocks')
            ->where('court_id', $courtId)
            ->where('starts_at', '<', $ends)
            ->where('ends_at', '>', $starts)
            ->exists();
        if ($blocked) {
            throw ApiException::conflict('Court is unavailable for this time');
        }
    }

    private function assertVenueRules(object $court, CarbonImmutable $starts, int $duration): void
    {
        $slot = max(15, (int) ($court->booking_slot_minutes ?? 30));
        $min = max(15, (int) ($court->min_booking_minutes ?? 60));
        $max = max(15, (int) ($court->max_booking_minutes ?? 120));
        if ($duration < $min || $duration > $max || $duration % $slot !== 0) {
            throw ApiException::validation('Booking duration is outside venue rules', [
                'slot_minutes' => $slot,
                'min_booking_minutes' => $min,
                'max_booking_minutes' => $max,
            ]);
        }
        $hours = json_decode((string) ($court->opening_hours ?? ''), true) ?: [];
        $localDate = $starts->setTimezone('Asia/Baku')->format('Y-m-d');
        $day = (string) CarbonImmutable::parse($localDate, 'Asia/Baku')->dayOfWeekIso;
        $rule = $hours[$day] ?? $hours[strtolower(CarbonImmutable::parse($localDate)->englishDayOfWeek)] ?? null;
        if (is_array($rule) && ($rule['closed'] ?? false)) {
            throw ApiException::conflict('Venue is closed on this day');
        }
        $open = is_array($rule) ? ($rule['open'] ?? '07:00') : '07:00';
        $close = is_array($rule) ? ($rule['close'] ?? '23:00') : '23:00';
        $openAt = CarbonImmutable::parse($localDate.' '.$open, 'Asia/Baku');
        $closeAt = CarbonImmutable::parse($localDate.' '.$close, 'Asia/Baku');
        $localStarts = $starts->setTimezone('Asia/Baku');
        if ($localStarts < $openAt || $localStarts->addMinutes($duration) > $closeAt) {
            throw ApiException::conflict('Booking is outside venue opening hours');
        }
    }

    private function bookingTotalMinor(object $court, int $durationMinutes): int
    {
        return (int) round(((int) $court->hourly_price_minor) * $durationMinutes / 60);
    }

    private function notificationRecipients(array $data)
    {
        $query = DB::table('users')->whereNull('deleted_at');
        if (! empty($data['user_ids'])) {
            return $query->whereIn('id', array_values(array_unique($data['user_ids'])))->get(['id']);
        }

        $targetRole = (string) ($data['target_role'] ?? 'admins');
        if ($targetRole === 'admins') {
            $query->whereIn('admin_role', ['admin', 'moderator']);
        } elseif ($targetRole === 'partners') {
            $query->where('admin_role', 'partner');
        } elseif ($targetRole === 'customers') {
            $query->whereNull('admin_role');
        } else {
            $query->where(function ($q) {
                $q->whereNotNull('admin_role')->orWhereNull('admin_role');
            });
        }

        return $query->limit(5000)->get(['id']);
    }

    private function notificationRow(string $id): object
    {
        $row = DB::table('notifications as n')
            ->leftJoin('users as u', 'u.id', '=', 'n.user_id')
            ->where('n.id', $id)
            ->first([
                'n.*',
                'u.email as user_email',
                'u.display_name as user_display_name',
                'u.photo_url as user_photo_url',
            ]);
        if (! $row) {
            throw ApiException::notFound('Notification not found');
        }

        return $row;
    }

    private function adminNotificationPayload(object $notification): array
    {
        $payload = json_decode((string) ($notification->payload ?? '{}'), true) ?: [];

        return [
            'id' => $notification->id,
            'user_id' => $notification->user_id,
            'user' => [
                'id' => $notification->user_id,
                'email' => $notification->user_email ?? null,
                'display_name' => $notification->user_display_name ?? null,
                'photo_url' => $notification->user_photo_url ?? null,
            ],
            'type' => $notification->type,
            'title' => $notification->title,
            'body' => $notification->body,
            'payload' => $payload,
            'severity' => $payload['severity'] ?? null,
            'is_read' => $notification->read_at !== null,
            'read_at' => $this->iso($notification->read_at),
            'created_at' => $this->iso($notification->created_at),
        ];
    }

    private function auditWrite(?string $actorUserId, string $action, string $entity, ?string $entityId = null, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
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
        if (Schema::hasTable('push_notification_jobs')) {
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

    private function auditPayload(object $entry): array
    {
        return [
            'id' => (string) $entry->id,
            'actor_user_id' => $entry->actor_user_id ? (string) $entry->actor_user_id : null,
            'actor_display_name' => $entry->actor_display_name,
            'action' => (string) $entry->action,
            'entity' => (string) $entry->entity,
            'entity_id' => (string) $entry->entity_id,
            'metadata' => $this->metadataPayload($entry->metadata),
            'created_at' => $this->iso($entry->created_at),
        ];
    }

    private function auditQuery(Request $request)
    {
        $query = DB::table('audit_log as a')->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id');
        if ($request->query('actor_user_id')) {
            $query->where('a.actor_user_id', $request->query('actor_user_id'));
        }
        if ($request->query('action')) {
            $query->where('a.action', $request->query('action'));
        }
        if ($request->query('entity')) {
            $query->where('a.entity', $request->query('entity'));
        }
        if ($request->query('entity_id')) {
            $query->where('a.entity_id', $request->query('entity_id'));
        }
        if ($request->query('from')) {
            $query->where('a.created_at', '>=', $request->query('from'));
        }
        if ($request->query('to')) {
            $query->where('a.created_at', '<=', $request->query('to'));
        }

        return $query;
    }

    private function metadataPayload(mixed $metadata): array
    {
        if (is_array($metadata)) {
            return $metadata;
        }
        if (is_object($metadata)) {
            return (array) $metadata;
        }
        if (is_string($metadata) && $metadata !== '') {
            $decoded = json_decode($metadata, true);
            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    private function courtById(string $courtId): array
    {
        $court = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.id', $courtId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['c.*', 's.slug as sport_slug']);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        return $this->courtPayload($court);
    }

    private function courtByVenueId(string $venueId, string $courtId): array
    {
        $court = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.venue_id', $venueId)
            ->where('c.id', $courtId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['c.*', 's.slug as sport_slug']);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        return $this->courtPayload($court);
    }

    private function courtPayload(object $court): array
    {
        return [
            'id' => (string) $court->id,
            'venue_id' => (string) $court->venue_id,
            'venue_name' => $court->venue_name ?? null,
            'sport_id' => (string) $court->sport_id,
            'sport_slug' => (string) $court->sport_slug,
            'sport_name' => $court->sport_name ?? null,
            'name' => (string) $court->name,
            'hourly_price_minor' => (int) $court->hourly_price_minor,
            'currency' => trim((string) $court->currency),
            'status' => $court->status ?? 'active',
            'photo_url' => $court->photo_url ?? null,
            'photo_urls' => $this->jsonArray($court->photo_urls ?? null),
            'created_at' => $this->iso($court->created_at),
        ];
    }

    private function venuePayload(object $venue): array
    {
        return [
            'id' => (string) $venue->id,
            'name' => (string) $venue->name,
            'address' => (string) $venue->address,
            'lat' => (float) $venue->lat,
            'lng' => (float) $venue->lng,
            'owner_user_id' => $venue->owner_user_id ? (string) $venue->owner_user_id : null,
            'is_partner' => (bool) $venue->is_partner,
            'phone' => $venue->phone ?? null,
            'description' => $venue->description ?? null,
            'photo_url' => $venue->photo_url ?? null,
            'photo_urls' => $this->jsonArray($venue->photo_urls ?? null),
            'status' => $venue->status ?? 'published',
            'opening_hours' => $this->metadataPayload($venue->opening_hours ?? null),
            'booking_slot_minutes' => (int) ($venue->booking_slot_minutes ?? 30),
            'min_booking_minutes' => (int) ($venue->min_booking_minutes ?? 60),
            'max_booking_minutes' => (int) ($venue->max_booking_minutes ?? 120),
            'cancellation_window_minutes' => (int) ($venue->cancellation_window_minutes ?? 120),
            'courts_count' => (int) ($venue->courts_count ?? 0),
            'bookings_count' => (int) ($venue->bookings_count ?? 0),
            'paid_revenue_minor' => (int) ($venue->paid_revenue_minor ?? 0),
            'created_at' => $this->iso($venue->created_at),
            'updated_at' => $this->iso($venue->updated_at ?? null),
        ];
    }

    private function ensureVenueExists(string $id): void
    {
        if (! DB::table('venues')->where('id', $id)->exists()) {
            throw ApiException::notFound('Venue not found');
        }
    }

    private function partnerAccountById(string $venueId, string $userId): array
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('admin_role', 'partner')
            ->where('venue_id', $venueId)
            ->first(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at']);
        if ($user === null) {
            throw ApiException::notFound('Partner account not found');
        }

        return $this->partnerAccountPayload($user);
    }

    private function partnerAccountPayload(object $user): array
    {
        return [
            'id' => (string) $user->id,
            'email' => (string) $user->email,
            'display_name' => (string) $user->display_name,
            'admin_role' => (string) $user->admin_role,
            'venue_id' => (string) $user->venue_id,
            'staff_title' => $user->staff_title ?? null,
            'staff_permissions' => $this->normalizePartnerPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null),
            'deleted_at' => $this->iso($user->deleted_at),
            'created_at' => $this->iso($user->created_at),
            'updated_at' => $this->iso($user->updated_at ?? null),
        ];
    }

    private function normalizePartnerPermissions(?array $permissions, bool $ownerDefaults = false): array
    {
        $base = [
            'dashboard' => true,
            'bookings' => true,
            'manual_booking' => true,
            'calendar' => true,
            'courts' => true,
            'maintenance' => true,
            'customers' => true,
            'reviews' => true,
            'reports' => true,
            'staff' => $ownerDefaults,
            'venue_settings' => $ownerDefaults,
            'revenue' => $ownerDefaults,
        ];
        if ($permissions === null) {
            return $base;
        }
        foreach ($base as $key => $default) {
            if (array_key_exists($key, $permissions)) {
                $base[$key] = (bool) $permissions[$key];
            }
        }

        return $base;
    }

    private function staffAccountById(string $id): array
    {
        $user = DB::table('users')->where('id', $id)->whereIn('admin_role', ['admin', 'moderator'])->first(['id', 'email', 'display_name', 'admin_role', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at']);
        if ($user === null) {
            throw ApiException::notFound('Staff account not found');
        }

        return $this->staffAccountPayload($user);
    }

    private function staffAccountPayload(object $user): array
    {
        return [
            'id' => (string) $user->id,
            'email' => (string) $user->email,
            'display_name' => (string) $user->display_name,
            'admin_role' => (string) $user->admin_role,
            'staff_title' => $user->staff_title ?? null,
            'staff_permissions' => $this->normalizeAdminStaffPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null, (string) $user->admin_role === 'admin'),
            'deleted_at' => $this->iso($user->deleted_at),
            'created_at' => $this->iso($user->created_at),
            'updated_at' => $this->iso($user->updated_at ?? null),
        ];
    }

    private function normalizeAdminStaffPermissions(?array $permissions, bool $adminDefaults = false): array
    {
        $base = [
            'dashboard' => true,
            'users' => $adminDefaults,
            'staff' => $adminDefaults,
            'venues' => true,
            'courts' => true,
            'bookings' => true,
            'games' => true,
            'tournaments' => true,
            'reports' => true,
            'reviews' => true,
            'operations' => $adminDefaults,
            'media' => true,
            'push_jobs' => $adminDefaults,
            'revenue' => $adminDefaults,
        ];
        if ($permissions === null) {
            return $base;
        }
        foreach ($base as $key => $default) {
            if (array_key_exists($key, $permissions)) {
                $base[$key] = (bool) $permissions[$key];
            }
        }

        return $base;
    }

    private function assertPasswordPolicy(string $password): void
    {
        if (! preg_match('/[A-Za-z]/', $password) || ! preg_match('/\d/', $password)) {
            throw ApiException::validation('Password must contain a letter and a digit');
        }
    }

    private function staff(Request $request, ?string $permission = null): object
    {
        $user = $this->authUser($request);
        $role = $user->admin_role;
        if (! in_array($role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Admin access required');
        }
        if ($role === 'moderator' && ($permission === null || ! $this->hasAdminPermission($user, $permission))) {
            throw ApiException::forbidden($permission === null ? 'Admin-only access required' : 'Admin permission required: '.$permission);
        }

        return $user;
    }

    private function staffOrVenuePartner(Request $request, string $venueId): void
    {
        $user = $this->authUser($request);
        if ($user->admin_role === 'admin') {
            return;
        }
        if ($user->admin_role === 'moderator' && $this->hasAdminPermission($user, 'venues')) {
            return;
        }
        if ($user->admin_role === 'partner' && (string) $user->venue_id === $venueId) {
            return;
        }

        throw ApiException::forbidden('Venue access required');
    }

    private function staffOrBookingPartner(Request $request, string $bookingId): void
    {
        $user = $this->authUser($request);
        if ($user->admin_role === 'admin') {
            return;
        }
        if ($user->admin_role === 'moderator' && $this->hasAdminPermission($user, 'bookings')) {
            return;
        }
        if ($user->admin_role !== 'partner' || $user->venue_id === null) {
            throw ApiException::forbidden('Booking access required');
        }

        $booking = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->where('b.id', $bookingId)
            ->first(['c.venue_id']);
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        if ((string) $booking->venue_id !== (string) $user->venue_id) {
            throw ApiException::forbidden('Booking access required');
        }
    }

    private function hasAdminPermission(object $user, string $permission): bool
    {
        $permissions = $this->normalizeAdminStaffPermissions(
            json_decode((string) ($user->staff_permissions ?? ''), true) ?: null,
            (string) $user->admin_role === 'admin'
        );

        return (bool) ($permissions[$permission] ?? false);
    }

    private function tournamentById(string $id): array
    {
        return $this->tournamentPayload($this->adminTournamentRowById($id));
    }

    private function adminTournamentRowById(string $id): object
    {
        $row = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->where('t.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['t.*', 's.slug as sport_slug', 's.name as sport_name', 'v.name as venue_name']);
        if ($row === null) {
            throw ApiException::notFound('Tournament not found');
        }

        return $row;
    }

    private function assertTournamentDateWindow(array $data, ?object $existing = null): void
    {
        $startsAt = array_key_exists('starts_at', $data) ? $data['starts_at'] : ($existing->starts_at ?? null);
        $endsAt = array_key_exists('ends_at', $data) ? $data['ends_at'] : ($existing->ends_at ?? null);
        $deadline = array_key_exists('registration_deadline', $data) ? $data['registration_deadline'] : ($existing->registration_deadline ?? null);

        if ($startsAt !== null && $endsAt !== null && CarbonImmutable::parse($endsAt)->lt(CarbonImmutable::parse($startsAt))) {
            throw ApiException::validation('ends_at must be after or equal to starts_at');
        }
        if ($deadline !== null && $startsAt !== null && CarbonImmutable::parse($deadline)->gt(CarbonImmutable::parse($startsAt))) {
            throw ApiException::validation('registration_deadline must be before or equal to starts_at');
        }
    }

    private function tournamentPayload(object $t): array
    {
        return [
            'id' => $t->id,
            'name' => $t->name,
            'description' => $t->description,
            'sport_id' => $t->sport_id,
            'sport_slug' => $t->sport_slug ?? null,
            'sport_name' => $t->sport_name ?? null,
            'venue_id' => $t->venue_id,
            'venue_name' => $t->venue_name ?? null,
            'starts_at' => $this->iso($t->starts_at),
            'ends_at' => $this->iso($t->ends_at),
            'registration_deadline' => $this->iso($t->registration_deadline),
            'max_squads' => (int) $t->max_squads,
            'squad_size' => (int) $t->squad_size,
            'entry_fee_minor' => (int) $t->entry_fee_minor,
            'currency' => $t->currency,
            'status' => $t->status,
            'entries_count' => DB::table('tournament_entries')->where('tournament_id', $t->id)->where('status', '!=', 'withdrawn')->count(),
            'created_at' => $this->iso($t->created_at),
        ];
    }

    private function tournamentEntriesPayload(string $tournamentId)
    {
        return DB::table('tournament_entries as e')
            ->join('users as u', 'u.id', '=', 'e.captain_user_id')
            ->where('e.tournament_id', $tournamentId)
            ->orderByDesc('e.created_at')
            ->get(['e.*', 'u.display_name as captain_display_name', 'u.photo_url as captain_photo_url', 'u.email as captain_email'])
            ->map(fn ($entry) => $this->tournamentEntryPayload($entry))
            ->values();
    }

    private function tournamentEntryPayload(object $entry): array
    {
        $playerIds = $this->pgArray($entry->player_ids);
        // Resolve display names so the admin UI shows squad members instead of a
        // blank line. Entries per tournament are few, so a single lookup is fine.
        $playerNames = [];
        if (! empty($playerIds)) {
            $nameMap = DB::table('users')
                ->whereIn('id', $playerIds)
                ->pluck('display_name', 'id');
            $playerNames = array_values(array_filter(array_map(
                fn ($id) => $nameMap[$id] ?? null,
                $playerIds,
            )));
        }

        return [
            'id' => (string) $entry->id,
            'tournament_id' => (string) $entry->tournament_id,
            'captain_user_id' => (string) $entry->captain_user_id,
            'captain_display_name' => $entry->captain_display_name,
            'captain_photo_url' => $entry->captain_photo_url,
            'captain_email' => $entry->captain_email ?? null,
            'squad_name' => $entry->squad_name,
            'player_ids' => $playerIds,
            'player_names' => $playerNames,
            'status' => $entry->status,
            'created_at' => $this->iso($entry->created_at),
        ];
    }

    private function pgArray(mixed $value): array
    {
        if ($value === null || $value === '{}') {
            return [];
        }

        return array_values(array_filter(str_getcsv(trim((string) $value, '{}'))));
    }

    private function jsonArray(mixed $value): array
    {
        if ($value === null || $value === '' || $value === '{}') {
            return [];
        }
        if (is_array($value)) {
            return array_values($value);
        }
        $decoded = json_decode((string) $value, true);
        if (is_array($decoded)) {
            return array_values($decoded);
        }

        return array_values(array_filter(str_getcsv(trim((string) $value, '{}'))));
    }

    private function pgTextArrayLiteral(?array $values): string
    {
        if ($values === null || $values === []) {
            return '{}';
        }

        return '{'.implode(',', array_map(function ($value) {
            return '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $value).'"';
        }, array_values($values))).'}';
    }
}
