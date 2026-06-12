import { z } from "zod";

// ── Profile ────────────────────────────────────────────────────────────
//
// The medical profile is intentionally permissive — every field is
// optional, capped to a sane length so a malicious caller can't fill GB
// of ciphertext into the bytea columns. We deliberately do NOT enforce
// blood-type from an enum so non-standard or localized identifiers ("0+",
// "A pos", "група A") survive without UI churn.

const BLOOD_TYPE_MAX = 8;
const ALLERGIES_MAX = 2_000;
const CONDITIONS_MAX = 2_000;
const MEDICATIONS_MAX = 2_000;
const CONTACT_NAME_MAX = 120;
const CONTACT_PHONE_MAX = 40;

/** GET /api/v1/me/medical-profile — owner read. The profile may not exist
 *  yet; in that case every field is null/false. */
export const MedicalProfileResponse = z.object({
  blood_type: z.string().nullable(),
  allergies: z.string().nullable(),
  conditions: z.string().nullable(),
  medications: z.string().nullable(),
  emergency_contact_name: z.string().nullable(),
  emergency_contact_phone: z.string().nullable(),
  share_medical_with_host: z.boolean(),
  updated_at: z.string().datetime().nullable(),
});
export type MedicalProfileResponse = z.infer<typeof MedicalProfileResponse>;

/** PUT body. Missing keys are not modified; explicit `null` clears the
 *  field. The boolean opt-in defaults to whatever was already on the row
 *  when omitted. */
export const UpdateMedicalProfileRequest = z
  .object({
    blood_type: z.string().max(BLOOD_TYPE_MAX).nullable().optional(),
    allergies: z.string().max(ALLERGIES_MAX).nullable().optional(),
    conditions: z.string().max(CONDITIONS_MAX).nullable().optional(),
    medications: z.string().max(MEDICATIONS_MAX).nullable().optional(),
    emergency_contact_name: z.string().max(CONTACT_NAME_MAX).nullable().optional(),
    emergency_contact_phone: z.string().max(CONTACT_PHONE_MAX).nullable().optional(),
    share_medical_with_host: z.boolean().optional(),
  })
  .strict();
export type UpdateMedicalProfileRequest = z.infer<typeof UpdateMedicalProfileRequest>;

// ── Host summary ───────────────────────────────────────────────────────
//
// Returned by `GET /api/v1/games/:id/medical-summary` to the game host.
// We surface only the three fields a host typically needs in an
// emergency (phone, allergies, blood type) and omit everything else by
// design — keeping the surface tight reduces blast radius if a host
// account is ever compromised. Participants who opted out of sharing
// are NOT present in `items` at all.

export const GameMedicalParticipant = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  blood_type: z.string().nullable(),
  allergies: z.string().nullable(),
  emergency_contact_phone: z.string().nullable(),
});
export type GameMedicalParticipant = z.infer<typeof GameMedicalParticipant>;

export const GameMedicalSummaryResponse = z.object({
  game_id: z.string().uuid(),
  items: z.array(GameMedicalParticipant),
});
export type GameMedicalSummaryResponse = z.infer<typeof GameMedicalSummaryResponse>;

// ── Tournament waivers ─────────────────────────────────────────────────

export const SignWaiverRequest = z.object({}).strict();
export type SignWaiverRequest = z.infer<typeof SignWaiverRequest>;

export const SignWaiverResponse = z.object({
  tournament_id: z.string().uuid(),
  user_id: z.string().uuid(),
  signed_at: z.string().datetime(),
  already_signed: z.boolean(),
});
export type SignWaiverResponse = z.infer<typeof SignWaiverResponse>;
