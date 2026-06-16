<?php

namespace App\Support;

use RuntimeException;

/**
 * Domain error with an explicit HTTP status + wire code. Services throw these;
 * the exception handler renders them through ErrorEnvelope. Mirrors the
 * public API codes the iOS client switches on.
 */
final class ApiException extends RuntimeException
{
    public function __construct(
        private readonly int $status,
        private readonly string $errorCode,
        string $message,
        private readonly ?array $details = null,
    ) {
        parent::__construct($message);
    }

    public function getStatusCode(): int
    {
        return $this->status;
    }

    public function wireCode(): string
    {
        return $this->errorCode;
    }

    public function getDetails(): ?array
    {
        return $this->details;
    }

    public static function unauthenticated(string $message = 'Invalid email or password'): self
    {
        return new self(401, 'UNAUTHENTICATED', $message);
    }

    public static function forbidden(string $message = 'Forbidden'): self
    {
        return new self(403, 'FORBIDDEN', $message);
    }

    public static function notFound(string $message = 'Not found'): self
    {
        return new self(404, 'NOT_FOUND', $message);
    }

    public static function conflict(string $message): self
    {
        return new self(409, 'CONFLICT', $message);
    }

    public static function validation(string $message = 'Request validation failed', ?array $details = null): self
    {
        return new self(400, 'VALIDATION_ERROR', $message, $details);
    }

    public static function rateLimited(string $message = 'Too many requests'): self
    {
        return new self(429, 'RATE_LIMITED', $message);
    }

    public static function internal(string $message = 'Internal server error', int $status = 500): self
    {
        return new self($status, 'INTERNAL', $message);
    }
}
