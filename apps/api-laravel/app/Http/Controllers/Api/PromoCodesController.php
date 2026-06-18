<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PromoCodesController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function validateCode(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'code' => ['required', 'string', 'max:64'],
            'amount_minor' => ['required', 'integer', 'min:0', 'max:100000000'],
            'currency' => ['sometimes', 'nullable', 'string', 'max:8'],
        ]);

        $promo = $this->activePromo($data['code']);
        if ($promo === null) {
            throw ApiException::validation('Promo code is not valid');
        }

        // Per-user usage is checked only for the authenticated caller (from the
        // optional Bearer token) — never a client-supplied user_id, which would
        // let anyone probe another user's redemptions.
        $viewerId = $this->optionalViewerId($request);
        // Uniform responses on this PUBLIC surface: usage-limit breaches collapse
        // into the same generic "not valid" 400 returned for an unknown code so
        // the endpoint never reveals whether a code (or a user's prior use of it)
        // exists. $publicSurface = true drives that collapse in assertUsageLimits.
        $discount = $this->discountMinor($promo, (int) $data['amount_minor'], $data['currency'] ?? $promo->currency, true);
        $this->assertUsageLimits($promo, $viewerId, true);

        return response()->json([
            'promo' => $this->payload($promo),
            'amount_minor' => (int) $data['amount_minor'],
            'discount_minor' => $discount,
            'total_minor' => max(0, (int) $data['amount_minor'] - $discount),
            'currency' => $data['currency'] ?? $promo->currency,
        ]);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->staff($request);
        $query = $this->validateQuery($request, [
            'q' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', 'in:active,inactive,archived'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
        ]);

        $base = DB::table('promo_codes');
        if (! empty($query['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $query['q']).'%';
            $base->where(fn ($q) => $q->where('code', 'ilike', $like)->orWhere('title', 'ilike', $like));
        }
        if (! empty($query['status'])) {
            $base->where('status', $query['status']);
        }

        $total = (clone $base)->count('id');
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);
        $items = $base->orderByDesc('created_at')->offset($offset)->limit($limit)->get()->map(fn ($promo) => $this->payload($promo))->values();

        return response()->json([
            'items' => $items,
            'pagination' => ['limit' => $limit, 'offset' => $offset, 'total' => $total],
        ]);
    }

    public function adminShow(Request $request, string $id): JsonResponse
    {
        $this->staff($request);
        $promo = DB::table('promo_codes')->where('id', $id)->first();
        if ($promo === null) {
            throw ApiException::notFound('Promo code not found');
        }

        return response()->json([
            ...$this->payload($promo),
            'recent_redemptions' => DB::table('booking_promo_redemptions as r')
                ->leftJoin('users as u', 'u.id', '=', 'r.user_id')
                ->leftJoin('bookings as b', 'b.id', '=', 'r.booking_id')
                ->where('r.promo_code_id', $id)
                ->orderByDesc('r.created_at')
                ->limit(25)
                ->get(['r.id', 'r.booking_id', 'r.user_id', 'u.display_name as user_name', 'u.email as user_email', 'r.discount_minor', 'r.created_at', 'b.status as booking_status'])
                ->map(fn ($row) => [
                    'id' => $row->id,
                    'booking_id' => $row->booking_id,
                    'user_id' => $row->user_id,
                    'user_name' => $row->user_name,
                    'user_email' => $row->user_email,
                    'discount_minor' => (int) $row->discount_minor,
                    'booking_status' => $row->booking_status,
                    'created_at' => $this->iso($row->created_at),
                ])
                ->values(),
        ]);
    }

    public function adminStore(Request $request): JsonResponse
    {
        $admin = $this->staff($request, true);
        $data = $this->promoData($request, true);
        $id = (string) Str::uuid();

        DB::table('promo_codes')->insert([
            'id' => $id,
            ...$data,
            'created_by_user_id' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'promo.create', 'promo_codes', $id, [
            'code' => $data['code'],
            'status' => $data['status'],
            'discount_type' => $data['discount_type'],
            'discount_value' => $data['discount_value'],
        ]);

        return $this->adminShow($request, $id)->setStatusCode(201);
    }

    public function adminUpdate(Request $request, string $id): JsonResponse
    {
        $admin = $this->staff($request, true);
        if (! DB::table('promo_codes')->where('id', $id)->exists()) {
            throw ApiException::notFound('Promo code not found');
        }
        $data = $this->promoData($request, false);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }

        DB::table('promo_codes')->where('id', $id)->update([...$data, 'updated_at' => now()]);
        $this->auditWrite($admin->id, 'promo.update', 'promo_codes', $id, [
            'fields' => array_keys($data),
            'updates' => $data,
        ]);

        return $this->adminShow($request, $id);
    }

    public function adminDelete(Request $request, string $id): JsonResponse
    {
        $admin = $this->staff($request, true);
        $deleted = DB::table('promo_codes')->where('id', $id)->update(['status' => 'archived', 'updated_at' => now()]);
        if ($deleted < 1) {
            throw ApiException::notFound('Promo code not found');
        }
        $this->auditWrite($admin->id, 'promo.archive', 'promo_codes', $id);

        return response()->json(['id' => $id, 'status' => 'archived']);
    }

    private function promoData(Request $request, bool $creating): array
    {
        $rules = [
            'code' => [$creating ? 'required' : 'sometimes', 'string', 'min:2', 'max:64'],
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'discount_type' => [$creating ? 'required' : 'sometimes', 'in:percent,fixed'],
            'discount_value' => [$creating ? 'required' : 'sometimes', 'integer', 'min:1', 'max:100000000'],
            'currency' => ['sometimes', 'nullable', 'string', 'max:8'],
            'min_amount_minor' => ['sometimes', 'integer', 'min:0', 'max:100000000'],
            'max_discount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'max_redemptions' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:10000000'],
            'per_user_limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'status' => ['sometimes', 'in:active,inactive,archived'],
        ];
        $data = $this->validateBody($request, $rules);
        if (isset($data['code'])) {
            $data['code'] = $this->normalizeCode($data['code']);
            $exists = DB::table('promo_codes')
                ->where('code', $data['code'])
                ->when($request->route('id'), fn ($q, $id) => $q->where('id', '!=', $id))
                ->exists();
            if ($exists) {
                throw ApiException::validation('Promo code already exists');
            }
        }
        if (($data['discount_type'] ?? null) === 'percent' && (int) ($data['discount_value'] ?? 0) > 100) {
            throw ApiException::validation('Percent discount cannot exceed 100');
        }
        if (! empty($data['starts_at'])) {
            $data['starts_at'] = CarbonImmutable::parse($data['starts_at']);
        }
        if (! empty($data['ends_at'])) {
            $data['ends_at'] = CarbonImmutable::parse($data['ends_at']);
        }
        if (! empty($data['starts_at']) && ! empty($data['ends_at']) && $data['ends_at'] <= $data['starts_at']) {
            throw ApiException::validation('ends_at must be after starts_at');
        }
        $data['currency'] = $data['currency'] ?? 'AZN';
        if ($creating) {
            $data['status'] = $data['status'] ?? 'active';
            $data['min_amount_minor'] = $data['min_amount_minor'] ?? 0;
            $data['per_user_limit'] = $data['per_user_limit'] ?? 1;
        }

        return $data;
    }

    private function activePromo(string $code): ?object
    {
        $now = now();

        return DB::table('promo_codes')
            ->where('code', $this->normalizeCode($code))
            ->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
            ->where(fn ($q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', $now))
            ->first();
    }

    /**
     * Enforce global + per-user redemption limits.
     *
     * On the PUBLIC validate endpoint these failures must not reveal that the
     * code (or this user's prior redemption of it) exists, so when called there
     * ($publicSurface) every limit breach is collapsed into the same generic
     * "not valid" 400 a non-existent code returns — uniform responses prevent
     * promo-code / per-user enumeration. Internal callers (e.g. redemption at
     * checkout) keep the precise messages by passing $publicSurface = false.
     */
    private function assertUsageLimits(object $promo, ?string $userId, bool $publicSurface = false): void
    {
        if ($promo->max_redemptions !== null) {
            $count = DB::table('booking_promo_redemptions')->where('promo_code_id', $promo->id)->count();
            if ($count >= (int) $promo->max_redemptions) {
                throw $publicSurface
                    ? ApiException::validation('Promo code is not valid')
                    : ApiException::conflict('Promo code redemption limit reached');
            }
        }
        if ($userId !== null && (int) ($promo->per_user_limit ?? 1) > 0) {
            $count = DB::table('booking_promo_redemptions')->where('promo_code_id', $promo->id)->where('user_id', $userId)->count();
            if ($count >= (int) $promo->per_user_limit) {
                throw $publicSurface
                    ? ApiException::validation('Promo code is not valid')
                    : ApiException::conflict('Promo code was already used by this user');
            }
        }
    }

    private function discountMinor(object $promo, int $amountMinor, ?string $currency, bool $publicSurface = false): int
    {
        // On the public validate surface these branches would otherwise confirm a
        // code exists (and leak its min-amount / currency); collapse them into the
        // same generic "not valid" message used for an unknown code. Internal
        // callers keep the precise messages ($publicSurface = false).
        $invalid = fn (string $message) => $publicSurface
            ? ApiException::validation('Promo code is not valid')
            : ApiException::validation($message);
        if ((int) ($promo->min_amount_minor ?? 0) > $amountMinor) {
            throw $invalid('Promo code minimum amount was not reached');
        }
        if (($promo->currency ?? 'AZN') !== ($currency ?? 'AZN')) {
            throw $invalid('Promo code currency does not match booking currency');
        }
        $discount = $promo->discount_type === 'percent'
            ? (int) floor($amountMinor * (int) $promo->discount_value / 100)
            : (int) $promo->discount_value;
        if ($promo->max_discount_minor !== null) {
            $discount = min($discount, (int) $promo->max_discount_minor);
        }

        return min($amountMinor, max(0, $discount));
    }

    private function payload(object $promo): array
    {
        return [
            'id' => $promo->id,
            'code' => $promo->code,
            'title' => $promo->title,
            'description' => $promo->description,
            'discount_type' => $promo->discount_type,
            'discount_value' => (int) $promo->discount_value,
            'currency' => $promo->currency,
            'min_amount_minor' => (int) ($promo->min_amount_minor ?? 0),
            'max_discount_minor' => $promo->max_discount_minor !== null ? (int) $promo->max_discount_minor : null,
            'max_redemptions' => $promo->max_redemptions !== null ? (int) $promo->max_redemptions : null,
            'per_user_limit' => (int) ($promo->per_user_limit ?? 1),
            'status' => $promo->status,
            'starts_at' => $this->iso($promo->starts_at),
            'ends_at' => $this->iso($promo->ends_at),
            'redemptions_count' => DB::table('booking_promo_redemptions')->where('promo_code_id', $promo->id)->count(),
            'created_by_user_id' => $promo->created_by_user_id ?? null,
            'created_at' => $this->iso($promo->created_at),
            'updated_at' => $this->iso($promo->updated_at),
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

    private function staff(Request $request, bool $write = false): object
    {
        if ($write) {
            return $this->requirePlatformAdmin($request);
        }

        return $this->requireAdminPermission($request, 'revenue');
    }

    private function normalizeCode(string $code): string
    {
        return strtoupper(preg_replace('/\s+/', '', trim($code)));
    }
}
