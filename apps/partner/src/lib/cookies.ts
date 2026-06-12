// Tiny cookie helper — works from the browser only.
// Tokens live in cookies (not httpOnly because they're set client-side) so the
// Next.js middleware can read them on every request. They are scoped with
// SameSite=Lax + Secure where possible.

export const ACCESS_TOKEN_COOKIE = "lf_admin_access";
export const REFRESH_TOKEN_COOKIE = "lf_admin_refresh";

const isBrowser = (): boolean => typeof document !== "undefined";

function buildCookie(name: string, value: string, maxAgeSeconds: number): string {
  const secure =
    isBrowser() && window.location.protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (!isBrowser()) return;
  document.cookie = buildCookie(name, value, maxAgeSeconds);
}

export function getCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const target = `${name}=`;
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }
  return null;
}

export function deleteCookie(name: string): void {
  if (!isBrowser()) return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
