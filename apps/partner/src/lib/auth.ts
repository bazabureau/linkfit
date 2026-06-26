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
  // The API still returns these in the JSON body (mobile clients read them), but
  // the web panel ignores them: auth rides on the httpOnly `lf_access` /
  // `lf_refresh` cookies the same response sets via Set-Cookie.
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
}

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
  // credentials:"include" (added by `api`) lets the browser store the httpOnly
  // auth cookies the response sets — no tokens are persisted from JS.
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
    throw new APIError({
      code: "forbidden_not_partner",
      message: "This account does not have partner access.",
      status: 403,
    });
  }

  return session.user;
}

export async function getCurrentUser(): Promise<AdminUser> {
  return api.get<AdminUser>("/api/v1/me");
}

export async function logout(): Promise<void> {
  // Best-effort revoke. The API reads the refresh token from the httpOnly
  // `lf_refresh` cookie (credentials:"include") and clears both auth cookies via
  // Set-Cookie — we send no token in the body. We redirect regardless of outcome.
  try {
    await api.post<void>("/api/v1/auth/logout", undefined, {
      skipRefresh: true,
    });
  } catch {
    /* swallow — we still want to redirect. */
  }
  if (typeof window !== "undefined") {
    window.location.assign(`${OWNER_BASE_PATH}/login`);
  }
}
