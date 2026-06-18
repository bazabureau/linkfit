# Linkfit iOS Design Guidelines

> **Status**: Updated 2026-06-17 for the native 2026 UI pass.
>
> **This file is the single source of truth.** Every new screen MUST
> follow the components and rules below. Deviations need explicit
> justification in the PR description.

Linkfit feels like a real sports product: practical, fast, premium, restrained. We avoid generic "AI app" styling: no neon washes, no animated glow blobs, no glass on every card, no oversized decorative hero panels. The current brand language is **adaptive light/dark surfaces + royal-blue accent (#5662D9) + lime-yellow secondary (#DCF166)**. The lime-yellow is reserved for the brand mark and rare highlights; royal blue carries interactive meaning.

---

## 1. Product Principles

- Lead with user data, available games, venues, and next actions.
- Dense enough for repeated use, but clear spacing between sections.
- Prefer native iOS structure: lists, sheets, compact cards, toolbars, segmented controls, visible tab labels.
- Use illustration only when it communicates state.
- Tone direct and localized. Never hardcode user-facing strings in English.

---

## 2. Native 2026 Pattern (CANONICAL)

This is the layout language every full-screen flow uses. It follows Apple's current direction: content first, native navigation, Liquid Glass only for chrome/controls, and restrained materials.

### 2.1 Page scaffold

```swift
ZStack {
    AppGlassBackground()           // adaptive solid app background

    ScrollView {
        VStack(spacing: 24) {
            // native navigation title / toolbar owns chrome
            // optional compact hero only when it helps orientation
            // content sections — one concern each
            // primary CTA if the screen has a clear commit action
        }
        .padding(.horizontal, 20)
    }
    .scrollIndicators(.hidden)
    .scrollDismissesKeyboard(.interactively)
}
```

### 2.2 Required components

| Component | When to use | Key knobs |
|-----------|-------------|-----------|
| `AppGlassBackground` / `PremiumAuthBackground` | Full-screen backgrounds | solid adaptive canvas; no glow animation |
| `PremiumPageHero` | Top of every full-screen flow | `icon`, `titleKey`, `subtitleKey`, `alignment` (`.leading` default, `.center` for sheets) |
| `FloatingTextField` | Any text input on auth / forms | `labelKey`, `icon`, `text`, `contentType`, `isSecure`, `errorMessage` |
| `PrimaryAuthButton` | Single hero action per screen | `titleKey`, `isLoading`, `isEnabled`, `action` |
| `PremiumSocialButton` | Apple / Google sign-in | `provider`, `action` |
| `LogoWordmark` | Brand mark on auth + splash | `size` (`.s` 18, `.m` 28, `.l` 44, `.xl` 64, `.custom(n)`) |

### 2.3 Animation pattern

**Entrance**: use only when it clarifies state change. Auth may keep a short stagger; high-frequency app screens should appear immediately. If a stagger is justified, use the four-step pattern from `LoginView.stagger()`:

```swift
withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
    heroVisible = true
}
DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
    withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
        socialVisible = true
    }
}
// …continue at 0.10s intervals
```

Always honor Reduce Motion (`UIAccessibility.isReduceMotionEnabled`). Do not animate background decoration.

### 2.4 Haptic ladder

- `.light` → secondary actions (social button, toggle, switch)
- `.medium` → primary CTA submission
- `selectionChanged()` → segmented picker, tab change

---

## 3. Visual System

### 3.1 Tokens

Use **only** semantic tokens. Never raw `Color(red:green:blue:)` outside the design system.

All tokens are **adaptive** (light/dark via `Color(light:dark:)`). Never assume dark mode.

| Token | Use |
|-------|-----|
| `DSColor.background` | Page background (#FFFFFF light / #0A0E14 dark) |
| `DSColor.surface` | Card fill |
| `DSColor.surfaceElevated` | Field / pressed-card fill |
| `DSColor.inkSurface` | Bottom bar / hero overlay anchor |
| `DSColor.accent` | Brand royal blue (#5662D9). Interactive priority only, never a wash. |
| `DSColor.accentSoft / accentMuted` | Pressed state / tinted accent wash |
| `DSColor.secondary / secondaryMuted` | Brand lime-yellow (#DCF166). Brand mark + small highlights only. |
| `DSColor.textPrimary` | Body + headlines |
| `DSColor.textSecondary` | Supporting copy |
| `DSColor.textTertiary` | Hints, placeholders |
| `DSColor.textOnAccent` | Text/icons sitting on accent fills |
| `DSColor.border` | Strokes |
| `DSColor.danger / warning / success / info` | State only |
| `DSColor.medalGold / medalSilver / medalBronze` | Rank 1/2/3 styling only |

### 3.2 Typography

- **Hero title**: 26–30pt **heavy**, system default
- **Section title**: 17pt semibold, system default
- **Body**: 15–16pt regular
- **Caption / label**: 11–13pt semibold, sentence case, no tracking
- **Tagline / overline**: 11pt heavy, sentence case, no tracking

Use **default San Francisco** for product surfaces. **Rounded** only for small badges or sport-specific emphasis (never primary CTAs).

### 3.3 Spacing & radius

- Section gaps: **18–24pt** at the page level
- Card padding: **14pt**
- Field padding: **14pt horizontal**, **58pt height**
- Card radius: **18pt** continuous (was DSRadius.lg). Buttons: **16pt** continuous.
- Page horizontal padding: **20pt**

### 3.4 Quick-action accents

All quick-action tiles share the single brand accent (`DSColor.accent`). We tried four per-tile colours and reverted — on a busy background they read as noise. Iconography differentiates the tiles; colour does not. **Do not introduce per-card accent colours.** The only approved non-brand hues are the semantic state tokens and the medal tokens.

---

## 4. Navigation Chrome

Set once globally in `AppearanceBootstrap` (UIKit appearance proxies):

- **Tab bar**: system material / Liquid Glass where available, adaptive to light/dark
- **Selected tab**: filled SF Symbol + accent tint + heavy 11pt
- **Unselected**: outline icon + secondary text colour + semibold 11pt
- **Nav bar**: native material / Liquid Glass where available + heavy title (17pt small, 32pt large)
- **Tint color**: `DSColor.accent` — auto-tints back chevron + bar items

---

## 5. Layout Rules

- Cards frame **individual items or tools**, not entire page sections.
- **Never nest cards inside cards.**
- Stable sizes for tab bars, cards, buttons, carousels (data changes don't shift layout).
- Horizontal carousels: real items or clear empty states. Skeletons quiet and token-based.

---

## 6. Interaction

- Every visible icon-only control has an accessibility label.
- State changes fast and subtle; avoid large springy decorative movement.
- Empty states offer the next useful action when possible.
- Tap-to-focus must work on first tap (no `.opacity(0)` traps on inputs — see `FloatingTextField` history).
- Primary CTAs have a haptic, a small scale press, and a loading state.

---

## 7. Asset Pipeline

| Asset | Source | Generated by | Output |
|-------|--------|--------------|--------|
| App icon | `appicon.svg` | `scripts/generate-icons.mjs` | `AppIcon.appiconset/icon-1024.png` (RGB no alpha) |
| Background photo asset | `appicon.svg` | same script | `Background.imageset/*.png` (1x/2x/3x) |
| Wordmark | `logolinkfit.png` | manual copy | `Logo.imageset/logo.png` |
| Google G | `google-g.svg` | `scripts/generate-google-g.mjs` | `GoogleG.imageset/*.png` (1x/2x/3x) |

When the SVG source changes, rerun the relevant `node` script. App icon must be RGB (alpha-stripped) — the script uses ImageMagick to flatten.

---

## 8. Splash + Launch

- **Launch screen** (Info.plist): solid `BrandBackground` color (#0A0E14). No image, no text.
- **In-app SplashView**: dark page, centered 40pt `LogoWordmark`, fade-in tagline.
- Total runtime ~850ms (spring 550ms + tagline fade 320ms).
- Hooked into `RootView` via a `showingSplash` state gate.
- No decorative court scribbles, no orbital animations on splash — only the wordmark + tagline.

---

## 9. Auth Flow Specifics

All five auth screens (`LoginView`, `RegisterView`, `ForgotPasswordView`, `ResetPasswordView`, `AuthHero`) share:

1. `PremiumAuthBackground`
2. Top bar with `LanguagePicker()` trailing only (no logo — hero owns the identity)
3. `LogoWordmark(size: .custom(32))` centered in the hero
4. Heavy heading 28–30pt + supporting 15pt regular
5. Social-first hierarchy: `PremiumSocialButton(.apple)` and `(.google)` ABOVE the email/password form
6. `auth.or_email` uppercase divider before email block
7. Inline error rendering (`exclamationmark.circle.fill` + danger color)
8. Single `PrimaryAuthButton` at the end
9. Footer link to the sibling flow (login ↔ register)

---

## 10. Localization

- Every user-facing string is a `LocalizedStringKey` referencing `Localizable.xcstrings`.
- Provide az / en / ru for every key. Never ship a key with `state: "new"` — translate before merging.
- Microlabels (uppercase tags, taglines) are translated too. Don't just uppercase the English value.

---

## 11. Review Checklist

Before opening a PR with a new screen, confirm:

- [ ] Uses `PremiumAuthBackground` (or documented exception).
- [ ] Hero uses `PremiumPageHero` or a justified custom hero with the same layout.
- [ ] All inputs are `FloatingTextField`.
- [ ] Primary action uses `PrimaryAuthButton`.
- [ ] Social auth uses `PremiumSocialButton` (Apple/Google brand-compliant).
- [ ] Animation respects Reduce Motion.
- [ ] Haptics: light/medium/selection used where appropriate.
- [ ] Strings localized (az/en/ru).
- [ ] No `.opacity(0)` on tappable controls.
- [ ] Build, lint, tests all pass.
- [ ] No emoji in primary UI.
- [ ] No hardcoded `Color(red:green:blue:)` outside design tokens.
- [ ] No nested cards.

---

## 12. Component Quick-reference

```swift
// Background
PremiumAuthBackground()

// Hero
PremiumPageHero(
    icon: "figure.tennis",            // SF Symbol
    titleKey: "screen.title",         // localization key
    subtitleKey: "screen.subtitle",
    alignment: .leading               // or .center for modal sheets
)

// Text input
FloatingTextField(
    labelKey: "auth.email",
    icon: "envelope.fill",
    text: $email,
    keyboard: .emailAddress,
    contentType: .emailAddress,
    errorMessage: emailError
)

// Primary CTA
PrimaryAuthButton(
    titleKey: "screen.action",
    isLoading: viewModel.isSubmitting,
    isEnabled: viewModel.canSubmit
) {
    Task { await viewModel.submit() }
}

// Social auth
PremiumSocialButton(provider: .apple)  { Task { await viewModel.signInWithApple() } }
PremiumSocialButton(provider: .google) { Task { await viewModel.signInWithGoogle() } }

// Brand wordmark
LogoWordmark(size: .custom(32))
```

---

## 13. What NOT to do

- ❌ Custom green gradients with `HeroCurve` shape — removed during Premium pass.
- ❌ `BrandMark` as a procedural floret on auth screens — use `LogoWordmark` (the real PNG).
- ❌ Custom Google "G" drawn with `Circle.trim` arcs — use the official `Image("GoogleG")` asset.
- ❌ Decorative court-line scribbles or pulse animations on Splash.
- ❌ `.opacity(0)` on a TextField (breaks tap-to-focus).
- ❌ Nested card backgrounds.
- ❌ Hardcoded English strings in views.
- ❌ Inventing a 5th quick-action accent color.
- ❌ Skipping Reduce Motion checks.

---

## 13. Best-Practice Rules (FAZA 45 — strict)

These rules were added after a series of design audits and override
older conventions in this doc wherever they conflict.

### 13.1 Typography

| Element            | Size | Weight | Notes                                |
| ------------------ | ---- | ------ | ------------------------------------ |
| Page hero title    | 28pt | heavy  | Sentence case, no tracking.          |
| Section heading    | 18pt | heavy  | Sentence case, no tracking.          |
| Card title         | 15pt | heavy  | Sentence case.                       |
| Body               | 14pt | medium | Sentence case.                       |
| Caption / meta     | 12pt | semibold | Sentence case.                     |
| Button (primary)   | 14–15pt | heavy | Sentence case, no tracking.        |
| Badge / micro pill | 11pt | heavy  | **Sentence case** (no uppercase).    |

**❌ Banned forever:**
- `.textCase(.uppercase)` anywhere in views.
- `.tracking(...)` of any value.
- Mixing display-rounded with default-design fonts in the same view.

**Rationale:** uppercase + letter spacing produces a "system / form
label" tone that conflicts with Linkfit's social, friendly voice.
Weight hierarchy alone is enough to communicate "this is a heading."

### 13.2 Iconography

| Surface              | Icon size | Tap target |
| -------------------- | --------- | ---------- |
| Native toolbar item  | **17pt** (system default) | 44pt (system) |
| Native tab bar item  | 22–24pt (system) | 49pt (system) |
| Inline content icon  | 12–14pt  | n/a        |
| Hero medallion       | 22–24pt  | 50pt circle |
| List row accessory   | 11–13pt  | n/a        |

**Rules:**
- Do NOT set a `frame(width:height:)` on toolbar item images. Let
  SwiftUI render at system size. Custom 34×34 frames make icons read
  as "big custom widgets" instead of native toolbar items.
- Always specify `weight` on `Image(systemName:)` — semibold for
  toolbar, heavy for inline emphasis.
- Filled variants only for ACTIVE state (e.g. selected tab); outline
  for available state.

### 13.3 Spacing scale

Always use this scale, never arbitrary numbers:

```
2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32 · 40 · 56
```

- Section spacing (gaps between major blocks): **24–32pt**.
- Card internal padding: **14–18pt**.
- Inline element spacing: **6–10pt**.
- Page horizontal margins: **16pt**.

### 13.4 Navigation chrome

- **NavigationStack belongs INSIDE each tab**, never wrapping a
  TabView. See `HomeView.body` for the canonical pattern.
- Use **native `.navigationTitle` + `.toolbar`** — never custom
  `safeAreaInset(.top) { ... }` for chrome. Custom top bars look
  bespoke and break iOS expectations (long-press back, drag-back,
  status bar tap-to-top).
- `.navigationBarTitleDisplayMode(.inline)` for branded screens with
  toolbar items.
- `.large` only on root-of-stack content surfaces where the title
  carries hierarchy (Profile, Tournaments root).

### 13.5 Restraint (NEW rule, hard)

**A surface should NOT have:**
- A hero card AND a CTA row AND a stats card AND quick actions —
  pick ONE primary anchor.
- Mixed visual treatments for adjacent elements (glass cards +
  flat cards + gradient cards in the same scroll). One pattern.
- Decorative empty-state widgets that occupy more than 1 screen
  height of space when the user has zero data.

**A surface SHOULD have:**
- A clear single primary action OR pure feed of content (matches,
  players, clubs) — never both at full visual weight.
- Generous whitespace (28–32pt section spacing).
- The fewest sections that still convey the page's purpose.

**Specific to home:** the home tab does NOT need a hero CTA, because
the Matches tab has its own create-game `+` toolbar button. Home is
a *feed* — let it be a feed. Greeting → sections → done.

### 13.6 Sheets

- Always `.presentationBackground(.ultraThinMaterial)` when the
  sheet has its own opaque content background (the safe-area gutter
  reads as glass).
- Always `.presentationDragIndicator(.visible)` so the user knows
  they can dismiss by drag.
- Pick reasonable `.presentationDetents([.medium, .large])` —
  never `.fraction(...)` numbers that don't snap.

### 13.7 Accent budget

Limit `DSColor.accent` to **at most 3 visible surfaces per screen** —
primary CTA + one accent stroke + one micro-detail. More than that and
the brand colour becomes background noise instead of meaning.
`DSColor.secondary` (lime-yellow) is even scarcer: brand mark + at most
one highlight per screen.

---

**Last updated**: 2026-05-20 after FAZA 45 (strict best-practice
pass + hero removal + nav-bar rebuild).
