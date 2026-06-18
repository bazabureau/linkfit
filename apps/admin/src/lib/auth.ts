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

export async function loginAdmin(
  email: string,
  password: string,
): Promise<AdminUser> {
  // Use the role-gated admin endpoint: the API enforces admin/moderator
  // server-side and never issues a session for non-admin accounts. The check
  // below is kept only as client-side defense-in-depth.
  const session = await api.post<AuthSession>(
    "/api/v1/auth/admin/login",
    { email, password },
    { skipAuth: true, skipRefresh: true },
  );

  if (!session.user.admin_role) {
    // Drop any tokens the API issued — this account isn't allowed here.
    throw new APIError({
      code: "forbidden_not_admin",
      message: "This account does not have admin access.",
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
    window.location.assign("/login");
  }
}
