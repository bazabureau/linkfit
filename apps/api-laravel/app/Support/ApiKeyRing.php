<?php

namespace App\Support;

final class ApiKeyRing
{
    /**
     * @param  array<int,string>  $plainKeys
     * @param  array<int,string>  $keyHashes
     */
    public static function matches(string $provided, array $plainKeys, array $keyHashes = []): bool
    {
        if ($provided === '') {
            return false;
        }

        foreach ($plainKeys as $expected) {
            $expected = trim((string) $expected);
            if ($expected !== '' && hash_equals($expected, $provided)) {
                return true;
            }
        }

        $providedHash = hash('sha256', $provided);
        foreach ($keyHashes as $expectedHash) {
            $expectedHash = strtolower(trim((string) $expectedHash));
            if (self::isSha256Hex($expectedHash) && hash_equals($expectedHash, $providedHash)) {
                return true;
            }
        }

        return false;
    }

    public static function fingerprint(string $provided): ?string
    {
        $provided = trim($provided);
        if ($provided === '') {
            return null;
        }

        return substr(hash('sha256', $provided), 0, 16);
    }

    /**
     * @param  array<int,string>  $plainKeys
     */
    public static function assertStrongPlainKeys(string $label, array $plainKeys): void
    {
        foreach ($plainKeys as $key) {
            $key = trim((string) $key);
            $isPlaceholder = str_starts_with($key, 'dev-')
                || str_contains($key, 'change-in-prod')
                || str_contains($key, 'example');

            if ($key === '' || strlen($key) < 32 || $isPlaceholder) {
                throw new \RuntimeException(
                    "{$label} values must be strong random strings (>=32 chars, not placeholders) in production."
                );
            }
        }
    }

    /**
     * @param  array<int,string>  $keyHashes
     */
    public static function assertValidHashes(string $label, array $keyHashes): void
    {
        foreach ($keyHashes as $hash) {
            if (! self::isSha256Hex(trim((string) $hash))) {
                throw new \RuntimeException("{$label} values must be SHA-256 hex digests.");
            }
        }
    }

    public static function isSha256Hex(string $value): bool
    {
        return strlen($value) === 64 && ctype_xdigit($value);
    }
}
