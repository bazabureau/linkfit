/**
 * Server-side i18n primitives shared by every module that needs to render
 * user-facing copy outside the HTTP request hot path (push notifications,
 * digests, system emails).
 *
 * The three locales below mirror what the iOS client ships in
 * `Localizable.xcstrings`. Anything else is normalised to `az` — the
 * application's default locale — rather than the more conventional `en`,
 * because Linkfit is an AZ-first community app and an unknown header should
 * land the user in the most-likely-correct language, not a fallback that
 * looks foreign.
 */
export type SupportedLocale = "az" | "en" | "ru";

export const DEFAULT_LOCALE: SupportedLocale = "az";

const SUPPORTED: ReadonlySet<SupportedLocale> = new Set(["az", "en", "ru"]);

/**
 * Normalise a free-form locale string (typically `users.locale`, an
 * `Accept-Language` header, or a column that hasn't been backfilled yet)
 * into one of the three locales the templates ship copy for.
 *
 * Handles:
 *  - `null` / `undefined` → `az`
 *  - case differences (`AZ`, `En`) → lowercase
 *  - BCP-47 region suffixes (`en-US`, `ru-RU`) → strip region
 *  - anything still unrecognised → `az`
 */
export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (input === null || input === undefined) return DEFAULT_LOCALE;
  const head = input.toLowerCase().split("-")[0]?.trim() ?? "";
  if (head.length === 0) return DEFAULT_LOCALE;
  if (SUPPORTED.has(head as SupportedLocale)) return head as SupportedLocale;
  return DEFAULT_LOCALE;
}

/**
 * Substitute `{name}` placeholders in a template using the provided values.
 * Missing keys collapse to an empty string so a template referring to an
 * absent placeholder degrades gracefully (e.g. an unknown actor name renders
 * as a leading space rather than literal `{actor}` in a notification banner).
 *
 * Values are coerced to strings via `String(...)` — `undefined`/`null` become
 * empty strings instead of the literal `"undefined"` / `"null"`. Numbers and
 * booleans render verbatim.
 */
export function interpolate(
  template: string,
  values: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}
