# UI/UX Fix Brief (agent worker instructions)

You are fixing design-guideline violations in the Linkfit iOS app (SwiftUI, Swift 6).
The single source of truth is `apps/ios/DESIGN_GUIDELINES.md` — read it first, especially §13 (FAZA 45 strict rules). This brief distills the mechanical rules and adds operational constraints.

## Brand truth (do not re-theme)
- `DSColor.accent` = royal blue #5662D9 (interactive priority)
- `DSColor.secondary` = lime-yellow #DCF166 (brand mark + rare highlights)
- All tokens adaptive light/dark. Never assume dark mode.
- Tokens live in `Linkfit/Core/DesignSystem/Tokens/` (DSColor, DSType, DSSpacing, DSRadius). New: `DSColor.medalGold/medalSilver/medalBronze`.

## Mechanical fixes (apply to every file in your assigned scope)

1. **Remove every `.tracking(...)`** — no exceptions.
2. **Remove every `.textCase(.uppercase)`**. If the underlying string is a hardcoded ALL-CAPS English literal, convert to sentence case AND treat per rule 7 (localization).
3. **`design: .rounded` → `design: .default`** (or use a matching `DSType` ladder token if size/weight align: heroTitle 28 heavy, sectionTitle 18 heavy, cardTitle 15 heavy, bodyMedium 14 medium, bodyStrong 14 semibold, metaCaption 12 semibold, badge 11 heavy, button 15 heavy, statValue 24 heavy, statValueLarge 32 heavy). Uniform typography — no rounded/default mixing in one view.
4. **Hardcoded colors** (`Color(red:...)`, `Color(hex:...)`, `Color.white/.black` used as UI chrome) → map to `DSColor` tokens:
   - gold #FACC15/#CA8A04 → `DSColor.medalGold`; silver #9CA3AF/#4B5563 → `DSColor.medalSilver`; bronze #FB923C/#C2410C → `DSColor.medalBronze` (compose with `.opacity()` for fills)
   - near-black ink on lime/accent fills → `DSColor.limeInk` or `DSColor.textOnAccent`
   - blues → `DSColor.accent` or `DSColor.info`; reds → `danger`; ambers → `warning`; greens → `success`
   - whites/blacks → `textPrimary` / `background` / `surface` as semantically appropriate
   - EXEMPT: Stories drawing-canvas/text-overlay user-selectable palettes (content, not chrome), camera UI over the viewfinder, and Onboarding illustration files — leave those hues, they are illustration/content palettes.
5. **Emoji in primary UI is banned** (🥇🥈🥉 etc.) → SF Symbols (`medal.fill`, `trophy.fill`) tinted with medal tokens. Emoji typed by users (chat content, reactions) is fine.
6. **Toolbar items**: no `frame(width:height:)` on toolbar item images; system size, `.semibold` weight. Filled symbol variants only for active state.
7. **Localization**: user-facing hardcoded English strings must become `LocalizedStringKey`s. Use an existing key from `Linkfit/Resources/Localizable.xcstrings` if one fits (grep it read-only). If a new key is needed: use the key in code, but DO NOT edit `Localizable.xcstrings` — instead list the needed keys with proposed az/en/ru values in your final report.
8. **Sheets**: `.presentationDragIndicator(.visible)`; detents `[.medium]`, `[.large]`, or `[.medium, .large]` — replace `.fraction(...)`.
9. **Spacing**: arbitrary paddings/spacings snap to the scale `2 4 6 8 10 12 14 16 20 24 28 32 40 56`. Section gaps 24–32, card padding 14–18, page horizontal margins 16–20.
10. **No nested cards** (a card background inside another card background) — flatten the inner one to plain rows/dividers.
11. **Accessibility**: every icon-only tappable control gets `.accessibilityLabel`.
12. **Reduce Motion**: decorative/entrance animations must check `UIAccessibility.isReduceMotionEnabled` (follow existing patterns, e.g. LoginView).
13. **Restraint (§13.5)**: if a screen stacks hero card + CTA row + stats card + quick actions, or mixes glass/flat/gradient card treatments in one scroll — unify to ONE card treatment and ONE primary anchor. Prefer removing decoration over adding it.
14. **Accent budget**: at most 3 accent-coloured surfaces per screen; `DSColor.secondary` at most 1.

## Hard constraints
- ONLY edit files inside your assigned scope. Never touch: `Core/DesignSystem/Tokens/*`, `Localizable.xcstrings`, project.yml, files of other features.
- Do NOT change behavior, view models, networking, or navigation logic — presentation only.
- Do NOT run xcodebuild. After editing each file run `xcrun swiftc -parse <file>` and fix syntax errors (semantic errors about unknown types are expected and fine; only fix actual syntax issues).
- Keep diffs surgical; match surrounding code style; no new dependencies.

## Final report format
1. Files changed + one-line summary each
2. New localization keys needed: `key` → az / en / ru proposed values
3. Violations you saw but could NOT fix within constraints (e.g. needs shared component change)
