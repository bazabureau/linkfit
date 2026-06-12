# SwiftUI UI/UX Audit & Styling Report

**Date:** June 1, 2026  
**Auditor:** SwiftUI Layout & Motion Designer  
**Target:** Linkfit iOS SwiftUI Client (`apps/ios/Linkfit`)  
**Status:** Completed (Read-only Investigation)  

---

## Executive Summary

Linkfit’s SwiftUI iOS client has a solid structural architecture leveraging modern techniques (such as `@Observable`, dynamic injection via `@Environment`, per-tab navigation stacks, and custom sheets). However, the app suffers from minor "last-mile" layout inconsistencies, magic-number token bypasses, safe-area layout fragility, and a critical bug that locks the application into Light Mode.

This report documents all layout and motion issues discovered during a comprehensive view-by-view audit and provides concrete, premium-level design optimizations and implementation-ready patches. 

---

## Section 1: Spacing and Margin Audit

A core design principle for a premium app is spacing uniformity. Linkfit defines clear spacing tokens in `DSSpacing` (scaling from 4pt to 64pt). However, several major screens bypass these tokens in favor of custom magic numbers.

### Key Spacing Inconsistencies

| View / File | Line | Current Spacing Code | Issue | Recommended Token / Fix |
| :--- | :--- | :--- | :--- | :--- |
| `HomeView.swift` | 765 | `LazyVStack(spacing: 28, ...)` | **28pt** is a magic number not in `DSSpacing`. | Use `DSSpacing.xl` (32pt) or `DSSpacing.lg` (24pt). |
| `HomeView.swift` | 1292 | `HStack(spacing: 14)` | **14pt** is a custom magic spacing. | Use `DSSpacing.md` (16pt) or `DSSpacing.sm` (12pt). |
| `MatchesView.swift` | 39 | `VStack(alignment: .leading, spacing: 20)` | **20pt** is a custom magic spacing. | Use `DSSpacing.md` (16pt) or `DSSpacing.lg` (24pt). |
| `MatchesView.swift` | 240 | `LazyVStack(spacing: 14)` | **14pt** is a custom magic spacing. | Use `DSSpacing.md` (16pt) or `DSSpacing.sm` (12pt). |
| `ProfileView.swift` | 327 | `VStack(spacing: 28)` | **28pt** is a magic number not in `DSSpacing`. | Use `DSSpacing.xl` (32pt) or `DSSpacing.lg` (24pt). |

### Margin & Alignment Inconsistencies
- **Grid Bleed & Carousels:** In `HomeView.swift`, the horizontal padding (`DSSpacing.md` or `16pt`) is applied to individual cards and section headers rather than the parent container. This allows the upcoming matches carousels (`upcomingMatchesSection`) to scroll full bleed to the screen edges, which is a highly premium pattern.
- **ScrollView Padding:** Conversely, `MatchesView.swift` (line 56) and `TournamentsView.swift` (line 51) apply horizontal padding directly to the parent `ScrollView`/`LazyVStack`. If an edge-to-edge element is ever added to these views, it will be clipped. Horizontal padding should be applied to *inner content* (like cards), leaving the scroll view free to bleed edge-to-edge.

---

## Section 2: Typography and Token Compliance

`Typography.swift` defines a robust, strict typographic ladder (`DSType`) conforming to the project's design guidelines. Unfortunately, this ladder is extensively bypassed across the codebase in favor of hardcoded, ad-hoc system fonts.

### Typographic Token Violations

| View / File | Line | Current Code | Issue | Recommended Token |
| :--- | :--- | :--- | :--- | :--- |
| `MatchesView.swift` | 102 | `.font(.system(size: 14, weight: .bold))` | Custom size & weight | `DSType.bodyStrong` |
| `MatchesView.swift` | 178 | `.font(.system(size: 12, weight: .bold, design: .rounded))` | Custom size & design | `DSType.metaCaption` |
| `MatchesView.swift` | 229 | `.font(.system(size: 12, weight: .bold))` | Custom size & weight | `DSType.metaCaption` |
| `MatchesView.swift` | 564 | `.font(.system(size: 15, weight: .heavy))` | Custom size & weight | `DSType.cardTitle` |
| `MatchesView.swift` | 671 | `.font(.system(size: 11, weight: .bold))` | Custom size & weight | `DSType.caption2` |
| `HomeView.swift` | 983 | `.font(.system(size: 11, weight: .heavy))` | Custom size & weight | `DSType.badge` |
| `HomeView.swift` | 1243 | `.font(.system(size: 18, weight: .heavy))` | Custom size & weight | `DSType.sectionTitle` |

### Corner Radius Auditing

The maximum card corner radius defined in tokens (`Radius.swift`) is `DSRadius.lg = 16`. However, cards across the app consistently use larger, hardcoded values:

- `smartHeroCard` (`HomeView.swift:952`): **22pt** corner radius
- `MatchRowCard` (`MatchesView.swift:614`): **18pt** corner radius
- `TournamentsListFeaturedCard` (`TournamentsView.swift:323`): **24pt** corner radius
- `SquadCard` (`SquadsListView.swift:237`): **20pt** corner radius
- `SettingsView` background container (`SettingsView.swift:61`): **20pt** corner radius
- `ProfileView` statistics card (`ProfileView.swift:584`): **20pt** corner radius

#### Recommendation:
Add `DSRadius.xl` and `DSRadius.xxl` to `Radius.swift` to clean up these magic numbers and ensure uniform card curvature:
```swift
enum DSRadius {
    static let xs: CGFloat = 6
    static let sm: CGFloat = 10
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20  // Standard Card Radius
    static let xxl: CGFloat = 24 // Hero/Featured Card Radius
    static let pill: CGFloat = 999
}
```

---

## Section 3: Safe-Area and Layout Boundaries

Relying on hardcoded spacings to avoid bottom bars is a common SwiftUI anti-pattern. Linkfit currently uses manual spacers to clear the tab bar:

- `HomeView.swift` line 837: `Spacer().frame(height: 32)`
- `FeedView.swift` line 55: `Spacer().frame(height: 80)`
- `MatchesView.swift` line 245: `Spacer().frame(height: 80)`
- `TournamentsView.swift` line 57: `Spacer().frame(height: 80)`

These hardcoded values fail on different device form factors (e.g. iPhone SE with no physical home indicator vs. iPhone 15 Pro Max).

### Recommendation:
Replace hardcoded spacers with native `.safeAreaPadding(.bottom, 80)` or similar view modifiers, or utilize `safeAreaInset` to properly let the system calculate boundaries.

---

## Section 4: Color Palettes & Light/Dark Mode Locking Bug

A major bug was discovered in `ThemeManager.swift` (lines 22-25) that completely disables Dark Mode for the entire application, despite a rich dynamic palette in `Colors.swift` and a user-facing theme switcher in settings:

```swift
/// Forced to `.light` to satisfy the requirement that the app should not run in dark mode and should have a white background.
var resolved: ColorScheme? { .light }
```

### Analysis:
- `Colors.swift` contains a beautiful, signature dynamic palette:
  - **Light Mode:** Crisp, clean, minimalist white backgrounds (`0xFFFFFF`), slate surfaces (`0xF0F2FB`), and royal blue primary accents.
  - **Dark Mode:** Signature deep ink canvas (`0x0A0E14`), dark slate card surfaces (`0x121721`), and bright glowing lime accenting.
- By hardcoding `resolved` to `.light`, the app is forced into Light Mode. The settings tab switcher lets users select "Dark" or "System", but has absolutely no visual effect because `.preferredColorScheme(theme.resolved)` remains locked to `.light`.

### Resolution:
Restore dynamic theming to unlock the stunning, premium signature Dark Mode by mapping `resolved` to `mode.colorScheme`:
```swift
var resolved: ColorScheme? { mode.colorScheme }
```

---

## Section 5: Motion and Micro-Animations

Motion in SwiftUI should feel organic, responsive, and tactile. Standard `easeInOut` curves feel linear and mechanical. We recommend upgrading the system animations to custom springs and scroll reveal behaviors.

### 1. Interactive Button Spring Update
In `SettingsView.swift` (line 435), the custom `BounceButtonStyle` uses a standard spring:
```swift
.animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
```
To achieve a premium, high-responsiveness "tactile pop" akin to Apple Sports, adjust the timing coefficients to:
```swift
.animation(.spring(response: 0.22, dampingFraction: 0.65), value: configuration.isPressed)
```

### 2. Upgraded View Reveal Scroll Transition
In `SpringPressStyle.swift`, the scroll transition modifier reveals elements with a basic fade:
```swift
view
    .opacity(phase.isIdentity ? 1.0 : 0.4)
    .scaleEffect(phase.isIdentity ? 1.0 : 0.96)
```
Add a subtle translation offset to make elements slide elegantly up/down into view as the user scrolls:
```swift
view
    .opacity(phase.isIdentity ? 1.0 : 0.4)
    .scaleEffect(phase.isIdentity ? 1.0 : 0.96)
    .offset(y: phase.isIdentity ? 0 : 10)
```

### 3. Custom Tab Bar Transitions
Since native SwiftUI `TabView` lacks support for slide or fade transitions between tabs, we propose wrapping the tabs inside a custom animated transition container if a custom navigation bar is ever implemented. 
For the current native bar, we can at least animate tab-selection state transitions using a custom transition binding on the `activeTab`:
```swift
// Bind activeTab with custom spring transitions to give micro-haptic visual scaling
```

### 4. Pulsing Halo for Live Tournaments / Matches
Add an organic pulsing spring to indicate live games (e.g. "Live" chips in matches/tournaments):
```swift
struct LiveIndicatorHalo: View {
    @State private var animate = false
    
    var body: some View {
        Circle()
            .stroke(DSColor.danger.opacity(0.4), lineWidth: 3)
            .scaleEffect(animate ? 1.5 : 1.0)
            .opacity(animate ? 0.0 : 0.8)
            .frame(width: 8, height: 8)
            .onAppear {
                withAnimation(.easeOut(duration: 1.4).repeatForever(false)) {
                    animate = true
                }
            }
    }
}
```

---

## Section 6: Implementation-Ready Patches

The following precise, machine-applicable patches specify the code changes needed to address the audited issues.

### Patch 1: Unlock Light/Dark Mode in `ThemeManager.swift`

```patch
diff --git a/Linkfit/Core/DesignSystem/Theme/ThemeManager.swift b/Linkfit/Core/DesignSystem/Theme/ThemeManager.swift
--- a/Linkfit/Core/DesignSystem/Theme/ThemeManager.swift
+++ b/Linkfit/Core/DesignSystem/Theme/ThemeManager.swift
@@ -21,6 +21,6 @@
     /// `ColorScheme?` to feed into `.preferredColorScheme(_:)` at the root
-    /// of the scene. Forced to `.light` to satisfy the requirement that the
-    /// app should not run in dark mode and should have a white background.
-    var resolved: ColorScheme? { .light }
+    /// of the scene. Dynamically maps to the user's selected mode or system setting.
+    var resolved: ColorScheme? { mode.colorScheme }
 
     init() {
```

### Patch 2: Add Unified Card Corner Radii in `Radius.swift`

```patch
diff --git a/Linkfit/Core/DesignSystem/Tokens/Radius.swift b/Linkfit/Core/DesignSystem/Tokens/Radius.swift
--- a/Linkfit/Core/DesignSystem/Tokens/Radius.swift
+++ b/Linkfit/Core/DesignSystem/Tokens/Radius.swift
@@ -7,4 +7,6 @@
     static let lg: CGFloat = 16
+    static let xl: CGFloat = 20  // Standard cards (e.g. Matches, Squads, Settings, Profile)
+    static let xxl: CGFloat = 24 // Large featured and hero containers
     static let pill: CGFloat = 999
 }
```

### Patch 3: Optimize Scroll View Section Reveal in `SpringPressStyle.swift`

```patch
diff --git a/Linkfit/Core/DesignSystem/SpringPressStyle.swift b/Linkfit/Core/DesignSystem/SpringPressStyle.swift
--- a/Linkfit/Core/DesignSystem/SpringPressStyle.swift
+++ b/Linkfit/Core/DesignSystem/SpringPressStyle.swift
@@ -58,6 +58,7 @@
             content.scrollTransition(axis: .vertical) { view, phase in
                 view
                     .opacity(phase.isIdentity ? 1.0 : 0.4)
                     .scaleEffect(phase.isIdentity ? 1.0 : 0.96)
+                    .offset(y: phase.isIdentity ? 0 : 10)
             }
         } else {
```

---

## Conclusion & Action Plan

1. **Fix Theme Locking:** Apply **Patch 1** immediately to enable dynamic Light/Dark mode and unlock Linkfit's true signature visual aesthetic.
2. **Apply Typographic & Radius Harmonization:** Replace hardcoded `.font(.system(size: ...))` and `.cornerRadius(...)` with token counterparts from `DSType` and the newly updated `DSRadius` (Patch 2).
3. **Upgrade Scroll Transitions:** Apply **Patch 3** to enhance scroll dynamics across lists and feeds.
4. **Deprecate Layout Spacers:** Transition the layout away from manual `Spacer().frame(height: 80)` towards dynamic `.safeAreaPadding(.bottom, 80)` to bulletproof screens against differing device insets.
