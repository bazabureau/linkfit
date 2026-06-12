import SwiftUI

/// Word-based skill levels surfaced everywhere ELO ratings appear in the UI.
///
/// **Why this exists.** ELO ("Elo rating system", Arpad Elo, 1903–1985) is the
/// chess-rating system most padel platforms quietly use under the hood. But
/// the term itself is jargon — Azerbaijani padel players (and most casual
/// players globally) recognise Playtomic-style 1.0–7.0 levels or simple
/// "Beginner / Intermediate / Advanced / Pro" labels, not "ELO 1450". This
/// helper hides the integer entirely and surfaces a human-readable level
/// instead. Backend keeps the ELO mechanism unchanged; iOS only renders
/// the semantic label.
///
/// **Threshold tuning.** Buckets align with Playtomic's bands:
///   • `< 1100`  → Beginner       (Playtomic ≲ 2.0)
///   • `1100..<1400` → Intermediate (Playtomic 2.0–3.5)
///   • `1400..<1700` → Advanced     (Playtomic 3.5–5.0)
///   • `≥ 1700`  → Pro             (Playtomic ≳ 5.0)
///
/// If the product wants to retune (e.g. push "Pro" higher to reduce the
/// share of users with that label), change the thresholds here once; every
/// surface that reads `SkillLevel.from(elo:)` picks it up automatically.
enum SkillLevel: String, CaseIterable, Identifiable, Sendable {
    case beginner
    case intermediate
    case advanced
    /// "Peşəkar" / "Pro" — top tier. The raw value `expert` matches the
    /// project's existing `skill.expert` localization key; the displayed
    /// AZ wording is "Peşəkar" per product preference.
    case expert

    var id: String { rawValue }

    /// Map an ELO integer to its bucket. Nil ELO (player with no recorded
    /// games yet) falls through as `.beginner` — the most welcoming default
    /// for a brand-new user opening their first profile.
    static func from(elo: Int?) -> SkillLevel {
        guard let elo else { return .beginner }
        switch elo {
        case ..<1100: return .beginner
        case 1100..<1400: return .intermediate
        case 1400..<1700: return .advanced
        default: return .expert
        }
    }

    /// Localized display name. Pulls from `skill.beginner / .intermediate /
    /// .advanced / .expert` keys in `Localizable.xcstrings`. Returning
    /// `LocalizedStringKey` (not `String`) so SwiftUI re-evaluates when the
    /// user changes locale at runtime via `LocaleManager`.
    var labelKey: LocalizedStringKey {
        switch self {
        case .beginner:     return "skill.beginner"
        case .intermediate: return "skill.intermediate"
        case .advanced:     return "skill.advanced"
        case .expert:       return "skill.expert"
        }
    }

    /// Same word but as a plain `String` (already localized via
    /// `String(localized:)`). Use this when you need to splice the
    /// level into a string-format template (share copy, meta-line
    /// builders, accessibility labels) — `LocalizedStringKey` doesn't
    /// compose into `String` directly.
    var localizedName: String {
        switch self {
        case .beginner:     return String(localized: "skill.beginner")
        case .intermediate: return String(localized: "skill.intermediate")
        case .advanced:     return String(localized: "skill.advanced")
        case .expert:       return String(localized: "skill.expert")
        }
    }

    /// Display-only short caption used in compact contexts (player row
    /// chips, leaderboard cells) where the full word would wrap. Same
    /// localization keys as `labelKey` — short variants live under
    /// `skill.short.*`.
    var shortKey: LocalizedStringKey {
        switch self {
        case .beginner:     return "skill.short.beginner"
        case .intermediate: return "skill.short.intermediate"
        case .advanced:     return "skill.short.advanced"
        case .expert:       return "skill.short.expert"
        }
    }

    /// Accent colour for the level pill. Beginner = neutral, escalating
    /// toward the brand accent at the top. Subtle — every level still
    /// reads as a Linkfit token, no shouting reds for Pros.
    var accent: Color {
        switch self {
        case .beginner:     return DSColor.textTertiary
        case .intermediate: return DSColor.textSecondary
        case .advanced:     return DSColor.accent.opacity(0.85)
        case .expert:       return DSColor.accent
        }
    }

    /// SF Symbol that matches the level — leaf for beginner ramping to
    /// trophy for pro. Surfaces alongside the label in horizontal chips
    /// so the bucket is recognisable at a glance even before the user
    /// reads the word.
    var systemImage: String {
        switch self {
        case .beginner:     return "leaf"
        case .intermediate: return "figure.tennis"
        case .advanced:     return "flame"
        case .expert:       return "trophy.fill"
        }
    }
}
