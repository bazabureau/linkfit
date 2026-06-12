import SwiftUI

/// All type goes through these. The semantic ladder is built on Apple's text
/// styles so Dynamic Type works for free at every accessibility size. The
/// `faza45*` ladder below mirrors the strict spec in `DESIGN_GUIDELINES.md`
/// section 13.1 — fixed-point sizes for surfaces where the FAZA 45 audit
/// requires exact metrics (hero counters, stat displays, badges).
///
/// Weight overrides via `.bold()` etc. on the modifier are fine, but prefer a
/// new ladder step over an ad-hoc `font(.system(size:weight:))`.
enum DSType {
    // MARK: - Dynamic Type ladder (preferred for body content)
    static let displayLarge  = Font.system(.largeTitle, design: .default, weight: .bold)
    static let displayMedium = Font.system(.title,      design: .default, weight: .bold)
    static let title         = Font.system(.title2,     design: .default, weight: .semibold)
    static let titleSmall    = Font.system(.title3,     design: .default, weight: .semibold)
    static let body          = Font.system(.body,       design: .default, weight: .regular)
    static let bodyEmphasis  = Font.system(.body,       design: .default, weight: .semibold)
    static let footnote      = Font.system(.footnote,   design: .default, weight: .regular)
    static let caption       = Font.system(.caption,    design: .default, weight: .medium)
    static let buttonLabel   = Font.system(.body,       design: .default, weight: .semibold)

    // MARK: - FAZA 45 strict ladder (fixed sizes, sentence case)
    //
    // Per DESIGN_GUIDELINES.md §13.1. Use these when a surface needs
    // pixel-stable hierarchy (hero counters, dashboards, badges). All sentence
    // case — no uppercase + tracking.
    /// 28pt heavy. Page hero titles.
    static let heroTitle      = Font.system(size: 28, weight: .heavy, design: .default)
    /// 18pt heavy. Section headings.
    static let sectionTitle   = Font.system(size: 18, weight: .heavy, design: .default)
    /// 15pt heavy. Card titles.
    static let cardTitle      = Font.system(size: 15, weight: .heavy, design: .default)
    /// 14pt medium. Default body inside cards/sheets.
    static let bodyMedium     = Font.system(size: 14, weight: .medium, design: .default)
    /// 14pt semibold. Body with emphasis (clickable rows, list rows).
    static let bodyStrong     = Font.system(size: 14, weight: .semibold, design: .default)
    /// 12pt semibold. Captions and meta info.
    static let metaCaption    = Font.system(size: 12, weight: .semibold, design: .default)
    /// 11pt heavy. Badge and micro-pill labels (sentence case).
    static let badge          = Font.system(size: 11, weight: .heavy, design: .default)
    /// 11pt semibold. Small microlabels under a value.
    static let caption2       = Font.system(size: 11, weight: .semibold, design: .default)
    /// 15pt heavy. Primary CTA / button label.
    static let button         = Font.system(size: 15, weight: .heavy, design: .default)
    /// Tabular numeric for stat counters (24pt heavy). Use `.monospacedDigit()` if needed.
    static let statValue      = Font.system(size: 24, weight: .heavy, design: .default)
    /// Large stat counter (32pt heavy). For headline metric on dashboards.
    static let statValueLarge = Font.system(size: 32, weight: .heavy, design: .default)
}
