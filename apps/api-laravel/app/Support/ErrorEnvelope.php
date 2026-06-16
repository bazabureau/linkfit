<?php

namespace App\Support;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

/**
 * Renders every error as the exact wire envelope API clients expect:
 *
 *   { "error": { "code": "...", "message": "...", "request_id": "..." } }
 *
 * The iOS `APIError.from(envelope:status:)` switches on `code`, so these
 * strings MUST stay identical to the public API contract:
 * UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | VALIDATION_ERROR |
 * RATE_LIMITED | INTERNAL.
 */
final class ErrorEnvelope
{
    public static function make(int $status, string $code, string $message, Request $request, ?array $details = null): JsonResponse
    {
        $error = [
            'code' => $code,
            'message' => $message,
            'request_id' => $request->attributes->get('request_id', $request->header('X-Request-Id', '')),
        ];
        if ($details !== null) {
            $error['details'] = $details;
        }

        return new JsonResponse(['error' => $error], $status);
    }

    public static function fromThrowable(Throwable $e, Request $request): JsonResponse
    {
        // Domain errors thrown deliberately by services carry their own
        // code/status (see ApiException).
        if ($e instanceof ApiException) {
            return self::make($e->getStatusCode(), $e->wireCode(), $e->getMessage(), $request, $e->getDetails());
        }

        if ($e instanceof ValidationException) {
            return self::make(400, 'VALIDATION_ERROR', 'Request validation failed', $request, [
                'issues' => $e->errors(),
            ]);
        }

        if ($e instanceof AuthenticationException) {
            return self::make(401, 'UNAUTHENTICATED', 'Authentication required', $request);
        }

        if ($e instanceof ModelNotFoundException || $e instanceof NotFoundHttpException) {
            return self::make(404, 'NOT_FOUND', 'Resource not found', $request);
        }

        if ($e instanceof HttpExceptionInterface) {
            $status = $e->getStatusCode();
            $code = match ($status) {
                401 => 'UNAUTHENTICATED',
                403 => 'FORBIDDEN',
                404 => 'NOT_FOUND',
                409 => 'CONFLICT',
                422, 400 => 'VALIDATION_ERROR',
                429 => 'RATE_LIMITED',
                default => 'INTERNAL',
            };

            return self::make($status, $code, $e->getMessage() ?: $code, $request);
        }

        // Unmapped — never leak internals to the client.
        report($e);
        $message = config('app.debug') ? $e->getMessage() : 'Internal server error';

        return self::make(500, 'INTERNAL', $message, $request);
    }
}
