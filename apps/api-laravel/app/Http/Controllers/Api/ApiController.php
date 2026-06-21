<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Auth\TokenService;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use DateTimeInterface;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

abstract class ApiController extends Controller
{
    protected function authUser(Request $request): User
    {
        $user = $request->attributes->get('auth_user');
        if (! $user instanceof User) {
            throw ApiException::unauthenticated('Authentication required');
        }

        return $user;
    }

    /**
     * Resolve the viewer id for an *optionally* authenticated (public) route.
     *
     * Public routes are not behind the `jwt` middleware, so `auth_user` is only
     * set on authed routes. The web client still sends a Bearer token on these
     * endpoints, so we softly decode it here to power viewer-context fields
     * (is_followed_by_me, liked_by_me, ...). A missing/invalid token yields null
     * instead of a 401 — the route stays public.
     */
    protected function optionalViewerId(Request $request): ?string
    {
        $user = $request->attributes->get('auth_user');
        if ($user instanceof User) {
            return (string) $user->id;
        }

        $header = (string) $request->header('Authorization', '');
        if (! str_starts_with($header, 'Bearer ')) {
            return null;
        }

        try {
            $claims = app(TokenService::class)->verifyAccess(substr($header, 7));

            $userId = isset($claims->sub) ? (string) $claims->sub : '';
            if ($userId === '') {
                return null;
            }

            return User::whereKey($userId)->whereNull('deleted_at')->exists() ? $userId : null;
        } catch (\Throwable) {
            return null;
        }
    }

    protected function validateBody(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            throw ApiException::validation('Request validation failed', [
                'issues' => $validator->errors()->toArray(),
            ]);
        }

        return $validator->validated();
    }

    protected function validateQuery(Request $request, array $rules): array
    {
        $validator = Validator::make($request->query(), $rules);
        if ($validator->fails()) {
            throw ApiException::validation('Request validation failed', [
                'issues' => $validator->errors()->toArray(),
            ]);
        }

        return $validator->validated();
    }

    /**
     * Decode a keyset pagination cursor (base64 of {ts,id}). Returns null on an
     * absent or malformed cursor so callers can treat it as "first page".
     */
    protected function decodeCursor(?string $raw): ?array
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $json = base64_decode($raw, true);
        if ($json === false) {
            return null;
        }
        $data = json_decode($json, true);
        if (! is_array($data) || ! isset($data['ts'], $data['id'])) {
            return null;
        }

        return ['ts' => (string) $data['ts'], 'id' => (string) $data['id']];
    }

    /**
     * Encode a keyset cursor from the last row of a page (its $tsField + id).
     * Returns null when there's no further page.
     */
    protected function encodeCursor(?object $last, string $tsField = 'created_at'): ?string
    {
        if ($last === null) {
            return null;
        }

        return base64_encode((string) json_encode([
            'ts' => $this->iso($last->{$tsField} ?? null),
            'id' => (string) ($last->id ?? ''),
        ]));
    }

    protected function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if ($value instanceof CarbonInterface) {
            return $value->toIso8601ZuluString('millisecond');
        }
        if ($value instanceof DateTimeInterface) {
            return $value->format('Y-m-d\TH:i:s.v\Z');
        }
        if (is_string($value)) {
            try {
                return CarbonImmutable::parse($value)->utc()->toIso8601ZuluString('millisecond');
            } catch (\Throwable) {
                return $value;
            }
        }

        return (string) $value;
    }
}
