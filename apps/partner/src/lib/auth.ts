import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  deleteCookie,
  setCookie,
} from "./cookies";
import { APIError, api } from "./api";

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  home_lat: number | null;
  home_lng: number | null;
  created_at: string;
  /**
   * Admin role from the backend. `null` (or missing) means the account is not
   * an admin and should not be allowed into the panel.
   */
  admin_role?: string | null;
}

export interface AuthSession {
  user: AdminUser;
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
}

const REFRESH_TTL_SECONDS = 60 * 60 * 24; // matches API refresh lifetime
// Raw browser navigations are not basePath-prefixed by Next.js, so prepend it
// manually (the panel is served under `/owner`).
const OWNER_BASE_PATH = process.env.NEXT_PUBLIC_OWNER_BASE_PATH || "/owner";

export async function loginAdmin(
  email: string,
  password: string,
): Promise<AdminUser> {
  // Use the role-gated owner endpoint: the API enforces the `partner` role
  // (and that the account is linked to a venue) server-side, and never issues a
  // session for other accounts. The check below is client-side defense-in-depth.
  const session = await api.post<AuthSession>(
    "/api/v1/auth/owner/login",
    { email, password },
    { skipAuth: true, skipRefresh: true },
  );

  const role = session.user.admin_role;
  // Only `partner` accounts can use this panel — the API's venue-scoped
  // endpoints (venueId()) reject admin/moderator, so admitting them here just
  // produces a broken dashboard that 403s on every data call.
  if (role !== "partner") {
    // Drop any tokens the API issued — this account isn't allowed here.
    throw new APIError({
      code: "forbidden_not_partner",
      message: "This account does not have partner access.",
      status: 403,
    });
  }

  setCookie(
    ACCESS_TOKEN_COOKIE,
    session.access_token,
    session.access_token_expires_in_seconds,
  );
  setCookie(REFRESH_TOKEN_COOKIE, session.refresh_token, REFRESH_TTL_SECONDS);

  return session.user;
}

export async function getCurrentUser(): Promise<AdminUser> {
  return api.get<AdminUser>("/api/v1/me");
}

export async function logout(): Promise<void> {
  // Best-effort revoke; we always clear local cookies regardless.
  try {
    const refresh =
      typeof document !== "undefined"
        ? document.cookie
            .split("; ")
            .find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE}=`))
            ?.split("=")[1]
        : undefined;
    if (refresh) {
      await api.post<void>(
        "/api/v1/auth/logout",
        { refresh_token: decodeURIComponent(refresh) },
        { skipRefresh: true },
      );
    }
  } catch {
    /* swallow — we still want to wipe cookies and redirect. */
  }
  deleteCookie(ACCESS_TOKEN_COOKIE);
  deleteCookie(REFRESH_TOKEN_COOKIE);
  if (typeof window !== "undefined") {
    window.location.assign(`${OWNER_BASE_PATH}/login`);
  }
}
