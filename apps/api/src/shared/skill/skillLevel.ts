/**
 * Skill-level bucketing — the single source of truth for translating raw ELO
 * integers into the word-based labels the iOS UI renders ("Yeni başlayan /
 * Orta / Təcrübəli / Peşəkar"). Mirrors `apps/ios/Linkfit/Core/Skill/
 * SkillLevel.swift` exactly; if you retune one side, retune the other.
 *
 * Thresholds (must stay in lock-step with iOS):
 *   - `elo < 1100`        → `"beginner"`
 *   - `elo 1100..<1400`   → `"intermediate"`
 *   - `elo 1400..<1700`   → `"advanced"`
 *   - `elo >= 1700`       → `"expert"`
 *   - `elo == null`       → `"beginner"`   (welcoming default for fresh accounts)
 *
 * Derived on read at every emitter site. We do NOT persist `skill_level` to
 * the DB — keeping it computed means a future retune is a one-line change
 * here that propagates everywhere on the next API request, with no migration.
 */

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

export const SkillLevelEnum = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

export function skillLevelFromElo(elo: number | null | undefined): SkillLevel {
  if (elo === null || elo === undefined) return "beginner";
  if (elo < 1100) return "beginner";
  if (elo < 1400) return "intermediate";
  if (elo < 1700) return "advanced";
  return "expert";
}
