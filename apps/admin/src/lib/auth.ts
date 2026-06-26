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
  // The API still returns these in the JSON body for the mobile/Bearer path; the
  // admin web app ignores them and relies on the httpOnly cookies the API sets.
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
}

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
    // This account isn't allowed here. The API already set httpOnly cookies on
    // the login response; the logout call below revokes them server-side so a
    // non-admin can't linger with a valid session.
    await logout({ redirect: false });
    throw new APIError({
      code: "forbidden_not_admin",
      message: "This account does not have admin access.",
      status: 403,
    });
  }

  // On success the API has set the httpOnly lf_access / lf_refresh cookies on
  // the response — there is nothing for JS to store.
  return session.user;
}

export async function getCurrentUser(): Promise<AdminUser> {
  return api.get<AdminUser>("/api/v1/me");
}

export async function logout(
  opts: { redirect?: boolean } = {},
): Promise<void> {
  const { redirect = true } = opts;
  // Best-effort server-side revoke. The API reads the refresh token from the
  // lf_refresh cookie (sent via `credentials: "include"`) and clears the
  // httpOnly auth cookies on its response — JS cannot clear them itself.
  try {
    await api.post<void>("/api/v1/auth/logout", undefined, {
      skipRefresh: true,
    });
  } catch {
    /* swallow — we still want to redirect. */
  }
  if (redirect && typeof window !== "undefined") {
    window.location.assign("/login");
  }
}
