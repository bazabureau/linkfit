/**
 * Azerbaijan phone-number normaliser. We accept whatever shape the user
 * types in the iOS form — `+994551234567`, `0551234567`, `994 55 123 45 67`
 * — and emit the canonical `+994...` form so downstream code (search,
 * dedupe, SMS) can rely on a single representation.
 *
 * Numbers that don't look Azerbaijani (anything outside the three input
 * shapes documented in the unit tests) are returned unchanged. We
 * deliberately do NOT validate the operator prefix or total digit count
 * past the obvious cases — a wider check belongs in a phone-validation
 * library, not in a normalisation helper that has to stay forgiving.
 */
export function normalizeAzPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("994")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `+994${digits.slice(1)}`;
  }
  if (digits.length === 9) return `+994${digits}`;
  return raw; // unchanged for non-AZ formats
}

/**
 * Convenience wrapper for the common "user might leave the field blank,
 * normalise if not" pattern. `null` and empty strings pass through so the
 * caller can store them verbatim.
 */
export function normalizeAzPhoneOrNull(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return normalizeAzPhone(trimmed);
}
