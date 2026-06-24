<?php

namespace App\Http\Controllers\Api\Concerns;

/**
 * Neutralises CSV formula injection in exported spreadsheets.
 *
 * A cell whose first character a spreadsheet would treat as the start of a
 * formula (= + - @, tab or carriage return) is prefixed with a single quote so
 * it renders as literal text instead of being evaluated. Every user-controlled
 * string column must pass through csvSafe() before fputcsv.
 */
trait SanitizesCsv
{
    protected function csvSafe(mixed $value): string
    {
        $value = (string) ($value ?? '');
        if ($value !== '' && in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'".$value;
        }

        return $value;
    }
}
