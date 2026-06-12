/**
 * Domain types. Never leak DB row shape (with password_hash) past the
 * repository — only `PublicUser` and `AuthenticatedUser` cross out.
 */

export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  home_lat: number | null;
  home_lng: number | null;
  created_at: string;
  /** ISO timestamp; null until the user has clicked the magic-link
   *  verification email. Surfaced so the iOS client can render the
   *  "Please verify your email" banner without a separate round-trip. */
  email_verified_at: string | null;
  /** "admin" or "moderator" if the user holds an admin role, else null.
   *  Surfaced on login so the admin panel can gate its routes without
   *  an additional /me round-trip. */
  admin_role: "admin" | "moderator" | "partner" | null;
}

export interface AuthSession {
  user: PublicUser;
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
}
