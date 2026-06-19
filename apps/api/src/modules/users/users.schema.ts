import { z } from "zod";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

/** Hard min only — full policy is validated in service via checkPasswordPolicy
 *  so the same rule applies to password updates later. */
export const PasswordSchema = z.string().min(12).max(200);

export const DisplayNameSchema = z.string().trim().min(1).max(80);

export const RegisterRequest = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    password_confirmation: z.string().max(200).optional(),
    display_name: DisplayNameSchema,
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
      .optional(),
    /**
     * Wave-10 viral referral hook. When present, the signup endpoint looks
     * the code up against `users.referral_code` and atomically:
     *   - sets `users.referred_by_user_id` on the new account,
     *   - bumps `users.referral_count` on the referrer,
     *   - writes a `referrals` ledger row,
     *   - emits a "Yeni dəvətli!" push to the referrer post-commit.
     * Wire shape is the same 6-char ambiguity-free code the redeem endpoint
     * accepts. Malformed / unknown codes are silently dropped server-side so
     * a fat-fingered query string never blocks signup. The route layer also
     * mirrors the `?ref=<code>` query param into this field for convenience.
     */
    ref: z.string().trim().min(1).max(16).optional(),
  })
  .refine(
    (body) =>
      body.password_confirmation === undefined || body.password_confirmation === body.password,
    {
      message: "Passwords do not match",
      path: ["password_confirmation"],
    },
  );
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({
  refresh_token: z.string().min(10).max(200),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const LogoutRequest = RefreshRequest;
export type LogoutRequest = z.infer<typeof LogoutRequest>;

export const UpdateMeRequest = z
  .object({
    display_name: DisplayNameSchema.optional(),
    photo_url: z.string().url().nullable().optional(),
    home_lat: z.number().min(-90).max(90).nullable().optional(),
    home_lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine(
    (v) =>
      v.display_name !== undefined ||
      v.photo_url !== undefined ||
      v.home_lat !== undefined ||
      v.home_lng !== undefined,
    { message: "Provide at least one field to update" },
  )
  .refine(
    (v) =>
      (v.home_lat === undefined && v.home_lng === undefined) ||
      (v.home_lat !== undefined && v.home_lng !== undefined),
    { message: "home_lat and home_lng must be provided together" },
  );
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  photo_url: z.string().nullable(),
  home_lat: z.number().nullable(),
  home_lng: z.number().nullable(),
  created_at: z.string(),
  email_verified_at: z.string().nullable(),
  admin_role: z.enum(["admin", "moderator", "partner"]).nullable(),
});

export const AuthSessionSchema = z.object({
  user: PublicUserSchema,
  access_token: z.string(),
  refresh_token: z.string(),
  access_token_expires_in_seconds: z.number().int().positive(),
});
