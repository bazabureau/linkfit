# Linkfit High-Fidelity UX Research, Simulation & Improvement Proposal
**Author**: Specialized UX Researcher & User Tester  
**Date**: 2026-06-01  
**Status**: Final & Signed Off  
**Scope**: B2C SwiftUI iOS App & Next.js B2B Partner Dashboard (Baku Padel Community)

---

## 🏛 1. Executive Summary & Core Insights

Linkfit is the premier sports community platform in Baku, Azerbaijan, connecting athletes with high-end padel venues such as **Sea Breeze Padel Club**, **Baku Padel**, and **Boulevard Padel**. To deliver a truly startup-grade, premium product experience, this document provides a comprehensive user experience (UX) simulation and rigorous cognitive/accessibility audit of both the **B2C iOS App (SwiftUI)** and the **B2B Partner Dashboard (Next.js)**.

### Core Discoveries
1. **Accessibility Disconnect**: Racket sport veterans in Baku (ages 46+) are transitioning rapidly from traditional tennis to padel. However, high-density elements and subtle contrast levels in dynamic screens create severe visual and cognitive friction for this demographic.
2. **Mental Math Burden**: Representing court pricing and booking splits raw in minor units (**qəpik**) at the database layer is technically sound, but exposing it directly in the B2B dashboard or B2C onboarding creates calculation fatigue for both administrators and players.
3. **Data Density Friction**: Multi-step ELO calibration, emergency medical profile fields, and dense scheduling tables present high interactive complexity. Visual layouts must be expanded with generous spacing, rigid contrast ratios (WCAG 2.2 AA), and absolute typographic clarity to look like they were handcrafted by elite human designers rather than automated engines.

---

## 👥 2. Baku Athlete Demographics & Accessibility Mapping

To evaluate the overall usability of the Linkfit platform, three distinct athlete segments in Baku have been simulated and mapped to specific interactive and visual constraints:

```
                  LINKFIT BAKU USER ARCHETYPES
  ┌─────────────────────────────┼─────────────────────────────┐
  ▼                             ▼                             ▼
[Gen Alpha & Gen Z]         [Millennials & Gen X]         [Seniors & Masters]
Ages 14–25                  Ages 26–45                    Ages 46+
- Social-first & fast-paced - Time-poor, high splits usage - Racket sports veterans
- Low latency, auto-matching- Emergency medical details   - High contrast, dynamic fonts
- Animated, dynamic pills   - Dynamic off-peak campaigns  - Plain Azerbaijani localizations
```

### 2.1 Segment A: Gen Alpha & Gen Z Athletes (Ages 14–25)
* **Profile**: Elite juniors and active university padel players playing at Baku Padel or Boulevard. Highly visual, mobile-first, and socially driven.
* **Proficiency**: Mobile natives. Low tolerance for static forms, empty states, or visual lag.
* **Key Platform Flows**: Smart Matchmaking Queue (M10), overlapping social avatar stacks, ELO calibration, wallet top-ups.
* **Simulated UX Need**: Fluid micro-animations, rapid transition feedback, instantly readable ELO level labels (e.g. `beginner`, `expert` with customized icons instead of raw integers), and clear social proofs (who is playing and what is their skill group).

### 2.2 Segment B: Millennials & Gen X Competitors (Ages 26–45)
* **Profile**: Busy Baku corporate professionals, startup founders, and high-income players at Sea Breeze.
* **Proficiency**: Tech-literate but highly time-poor. Frequently coordinate weekend doubles (2v2) and corporate leagues.
* **Key Platform Flows**: Split-booking transactions in qəpik, emergency medical profiles (crucial for intense summer heat in Baku), and push-notifications for targeted off-peak discount codes (M11 campaigns).
* **Simulated UX Need**: Frictionless split-payment validation, clean inputs that handle card storage/Stripe split checkouts effortlessly, quick access to emergency details, and zero visual noise during rapid calendar slot bookings.

### 2.3 Segment C: Seniors & Masters (Ages 46+)
* **Profile**: Legacy tennis players migrating to padel due to the lower physical recovery barrier. Frequently play friendly doubles at Boulevard Padel.
* **Proficiency**: Average tech proficiency. Face mild visual impairments (presbyopia), requiring comfortable readability in low or high bright-light environments (outdoor courts in midday sun).
* **Key Platform Flows**: Profile setup, language customization (strong preference for pure, organic Azerbaijani terms), and phone number SMS OTP verification.
* **Simulated UX Need**: Absolute conformance to Apple's Dynamic Type, high-contrast text rendering against backgrounds, larger touch targets ($\ge 44 \times 44$ pt), reduced motion flags (`@Environment(\.accessibilityReduceMotion)`), and highly visible error boundaries with simple, reassuring feedback.

---

## 🔄 3. Visual Flow & Navigation Sequences

### 3.1 B2C iOS SwiftUI Client Journey Simulation

```
[Onboarding Language Select] 
             │
             ▼ (Select AZ -> pure, organic local terms)
[Secure SMS OTP Verification]
             │
             ▼ (Large keypads, automatic auto-focus fields)
[Player Profile Setup] ──────> [Emergency Medical Details] (Generous padding, high contrast)
             │
             ▼
[ELO Skill Calibration] ────> [Smart Matchmaking (1v1 or 2v2)] (Skill badges with distinct icons)
```

1. **Onboarding & Language Selection (`OnboardingView.swift`)**:
   - The user selects `AZERBAIJANI` or `ENGLISH`. 
   - *Visual Simulation*: The screen features dark ink surfaces (`DSColor.inkSurface`) layered with premium spring-loaded transitions. The visual text sizes utilize dynamic ladders (`DSType.heroTitle`), preventing overlapping issues on smaller phone screens.
2. **SMS Verification**:
   - Auto-focusing numeric text fields with dynamic focus states and native carrier configurations (Azercell, Bakcell, Nar, Nakhtel).
   - *Visual Simulation*: Contrast levels are strictly preserved. In the event of a timeout, the error boundary provides supportive recovery options instead of dry system alerts.
3. **Player Profile & Calibration Questionnaire**:
   - Four strategic questions mapping the player's ELO bracket (Beginner, Amateur, Intermediate, Pro).
   - *Visual Simulation*: Options are formatted as comfortable, spacious tapping cards instead of crowded radio lists. Skill badges display with unique symbol icons (e.g., leaf for beginners, trophy for pros) to enforce instant comprehension.
4. **Smart Matchmaking & Booking (`MatchesView.swift`)**:
   - Entering the proximity matchmaking queue. Match details display ELO requirements, distance in kilometers (`game.distance_km`), and overlapping social avatars (`AvatarStack`).
   - *Visual Simulation*: Active filter chips (skill, role, result) scroll horizontally with generous padding, providing a premium visual feel that completely hides system complexity.

---

### 3.2 Next.js B2B Partner Dashboard Journey Simulation

```
[ magic link login ] ──────> [ Məkan İdarəetmə Paneli (Overview) ]
                                            │
               ┌────────────────────────────┴────────────────────────────┐
               ▼                                                         ▼
    [ Kortlarım (Court Settings) ]                              [ Endirimlər (Discounts) ]
    - Spacious list, dynamic zebra striping                      - Dynamic pricing setup
    - Single-tap "Yeni Kort" add modal                          - Proximity targeted off-peak alerts
    - Display AZN alongside raw qəpik                           - Live analytics in Az-locale charts
```

1. **Dashboard Entry & Overview (`page.tsx`)**:
   - Magical passwordless login redirecting to `dashboard.linkfit.az`.
   - *Visual Simulation*: The overview surfaces structural KPIs (Revenue, Occupancy, Bookings) in clear cards. Dynamic Recharts curves render past weekly revenue in Azerbaijani locale with responsive sizing, avoiding cramped chart axes.
2. **Court Settings (`courts/page.tsx`)**:
   - Administrators view and modify court specs, slots, and standard rates.
   - *Visual Simulation*: Spacious tables replace cramped data listings. Modals utilize large slide-out drawers, providing wide tap zones for quick mobile or tablet input.
3. **Dynamic Pricing & Campaign Management**:
   - Pushing targeted off-peak discount codes (e.g., `SEABREEZE20` for weekday bookings).
   - *Visual Simulation*: The campaign manager provides a visual playground representing off-peak pricing slots. Exposes minor units (**qəpik**) calculated instantly to **AZN** format, reducing cognitive arithmetic strain.

---

## 🔍 4. Dual-Platform Visual & Interaction Friction Points Audit

### 4.1 B2C iOS SwiftUI Client Friction Points

| File Path / Component | Direct Observation & Code Behavior | UX Impact & Accessibility Barrier | Rationale & Remediation |
|---|---|---|---|
| `OnboardingView.swift` (Lines 48–66) | Skip button uses `Capsule().fill(.ultraThinMaterial)` over rich background photography. | Skip button contrast falls below **3:1** in bright photos, making it invisible to older players. | Skip button must feature a solid dynamic backdrop with a distinct high-contrast stroke boundary. |
| `MatchesView.swift` (Lines 97–147) | Search bar has a height of `44` and spacing of `12`, with search text fixed at `.system(size: 14)`. | Touch area is too small for older athletes. Text size does not respect iOS system Dynamic Type sizes. | Upgrade text sizes to use dynamic system body fonts (`DSType.body`) and expand touch boundaries. |
| `MedicalProfileView.swift` (Lines 165–194) | `TextEditor` has a fixed minimum height of `90`, utilizing custom borders without dynamic dynamic type scaling. | Multi-line boxes feel visually cramped and clip typed medical text at larger accessibility scales. | Implement dynamic height calculation and provide explicit voice-over tags for screen reader usage. |
| `SkillLevel.swift` (Lines 37–45) | Hardcoded ELO bounds (`<1100`, `1100..<1400`, etc.) display only semantic strings without ELO scores. | Intermediate/Pro players cannot see their progress or exact ELO standing, causing confusion. | Keep the semantic badges but overlay minor ELO numbers in fine high-contrast subtitle fonts. |

---

### 4.2 Next.js B2B Partner Dashboard Friction Points

| File Path / Component | Direct Observation & Code Behavior | UX Impact & Accessibility Barrier | Rationale & Remediation |
|---|---|---|---|
| `courts/page.tsx` (Lines 293–324) | Dialog layout wraps form labels and inputs in compact `.space-y-4` structures, utilizing native dropdown selects. | Selecting sports options and entering decimal hourly rates feels extremely dense on tablet displays. | Refactor form into a multi-step structured layout, replacing standard dropdowns with large touch cards. |
| `page.tsx` (Lines 356–436) | Bookings Table displays customer details, court name, duration, and prices in small fonts with tight paddings. | Dense table headers and small status badges are illegible under high outdoor lighting conditions. | Introduce spacious vertical paddings (`py-4`), distinct row borders, and large high-contrast status colors. |
| `page.tsx` (Lines 258–294) | Periods revenue cards calculate and print currency raw as `P / 100` in minor units without clean decimal alignment. | Visual inconsistency where decimal points fluctuate based on length (e.g. `2000` vs `20.00`). | Enforce global Azerbaijani currency formators ensuring zero raw minor unit exposure without AZN labels. |
| `courts/page.tsx` (Lines 312–323) | Hourly price input field accepts raw numeric input with decimal steps, allowing free-form input. | Court owners frequently mistype values (e.g., entering cents instead of full AZN), breaking DB states. | Implement a visual sliding calculator displaying hourly pricing values in AZN and qəpik simultaneously. |

---

## 🎨 5. Specialized Design Solutions & Code Proposals

### 5.1 B2C Client: Spacious SwiftUI Onboarding & Medical Profiling

#### Solution A: Accessible ELO Calibration Option Card (`AccessibleCalibrationCard.swift`)
To prevent visual clutter and support older racket sports veterans, this SwiftUI component provides wide touch areas, dynamic type support, high contrast, and haptic confirmations:

```swift
import SwiftUI

struct AccessibleCalibrationCard: View {
    let title: String
    let description: String
    let points: Int
    let iconName: String
    let isSelected: Bool
    let action: () -> Void
    
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    
    var body: some View {
        Button(action: {
            Haptics.light()
            action()
        }) {
            HStack(spacing: DSSpacing.md) {
                // High-Contrast Icon Pill
                ZStack {
                    Circle()
                        .fill(isSelected ? DSColor.secondary : DSColor.surfaceElevated)
                        .frame(width: 44, height: 44)
                    
                    Image(systemName: iconName)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(isSelected ? DSColor.accent : DSColor.textPrimary)
                }
                
                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                    Text(title)
                        .font(DSType.bodyEmphasis)
                        .foregroundStyle(DSColor.textPrimary)
                        .multilineTextAlignment(.leading)
                    
                    Text(description)
                        .font(DSType.footnote)
                        .foregroundStyle(DSColor.textSecondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }
                
                Spacer()
                
                // Accessible Checkmark Indicator
                ZStack {
                    Circle()
                        .strokeBorder(isSelected ? DSColor.accent : DSColor.border, lineWidth: 2)
                        .frame(width: 24, height: 24)
                    
                    if isSelected {
                        Circle()
                            .fill(DSColor.accent)
                            .frame(width: 14, height: 14)
                    }
                }
            }
            .padding(DSSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(isSelected ? DSColor.accentMuted : DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(isSelected ? DSColor.accent : DSColor.border, lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(title). \(description)"))
        .accessibilityHint(Text("Seçmək üçün iki dəfə toxunun."))
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .animation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 0.85), value: isSelected)
    }
}
```

#### Solution B: Premium Accessible Medical Text Editor (`PremiumAccessibleTextEditor.swift`)
Replaces cramped multiline editors in `MedicalProfileView.swift` by implementing dynamic height, large custom inputs, and dynamic placeholder layouts:

```swift
import SwiftUI

struct PremiumAccessibleTextEditor: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    
    @FocusState private var isFocused: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(title)
                .font(DSType.metaCaption)
                .foregroundStyle(DSColor.textSecondary)
                .padding(.leading, 4)
            
            ZStack(alignment: .topLeading) {
                // High-Contrast Border Backdrop
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(DSColor.surface)
                    .shadow(color: isFocused ? DSColor.accent.opacity(0.05) : Color.clear, radius: 8, x: 0, y: 4)
                
                if text.isEmpty {
                    Text(placeholder)
                        .font(DSType.body)
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, DSSpacing.sm + 4)
                        .allowsHitTesting(false)
                }
                
                TextEditor(text: $text)
                    .font(DSType.body)
                    .scrollContentBackground(.hidden)
                    .foregroundStyle(DSColor.textPrimary)
                    .padding(.horizontal, DSSpacing.sm)
                    .padding(.vertical, DSSpacing.sm)
                    .frame(minHeight: 120, maxHeight: 240)
                    .focused($isFocused)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(isFocused ? DSColor.accent : DSColor.border, lineWidth: isFocused ? 2 : 1)
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(title). \(text.isEmpty ? placeholder : text)"))
    }
}
```

---

### 5.2 B2B Web: Clean Tailwind Dashboard UI Components

#### Solution A: Ultra-Spacious B2B Dashboard Table (`PremiumPartnerTable.tsx`)
Replaces high-density tables in `page.tsx` with a comfortable, high-contrast, perfectly aligned Tailwind layout optimized for tablets and outdoor venue administration desk environments:

```tsx
import React from "react";

interface TableColumn<T> {
  header: string;
  accessor: (item: T) => React.ReactNode;
  align?: "left" | "right" | "center";
}

interface PremiumPartnerTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  keyExtractor: (item: T) => string;
  emptyMessage?: string;
  isLoading?: boolean;
}

export function PremiumPartnerTable<T>({
  data,
  columns,
  keyExtractor,
  emptyMessage = "Məlumat tapılmadı.",
  isLoading = false,
}: PremiumPartnerTableProps<T>): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="w-full space-y-4 p-6 bg-slate-900/40 rounded-2xl border border-slate-800 animate-pulse">
        <div className="h-6 bg-slate-800 rounded-lg w-1/4"></div>
        <div className="space-y-3">
          <div className="h-12 bg-slate-800/60 rounded-xl"></div>
          <div className="h-12 bg-slate-800/60 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-900/20 border border-dashed border-slate-800 rounded-2xl">
        <p className="text-sm font-semibold text-slate-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden border border-slate-800 bg-slate-950/60 rounded-2xl backdrop-blur-md">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/30">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={`px-6 py-4.5 text-xs font-bold uppercase tracking-wider text-slate-400 ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                      ? "text-center"
                      : "text-left"
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {data.map((item, rowIdx) => (
              <tr
                key={keyExtractor(item)}
                className="group hover:bg-slate-900/20 transition-colors duration-150"
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className={`px-6 py-5 text-sm font-medium text-slate-200 ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    }`}
                  >
                    {col.accessor(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

#### Solution B: Interactive Court Price & Dynamic Currency Selector (`DynamicPricingForm.tsx`)
This form element bridges the database-layer requirement (storing minor units in **qəpik**) with premium, human-crafted user visibility (displaying **AZN** alongside visual conversions):

```tsx
import React, { useState, useEffect } from "react";

interface DynamicPricingFormProps {
  initialPriceMinor: number;
  onSave: (priceMinor: number) => void;
  isLoading?: boolean;
}

export function DynamicPricingForm({
  initialPriceMinor,
  onSave,
  isLoading = false,
}: DynamicPricingFormProps): React.JSX.Element {
  const [priceAZN, setPriceAZN] = useState<string>(
    (initialPriceMinor / 100).toFixed(2)
  );
  const [priceMinor, setPriceMinor] = useState<number>(initialPriceMinor);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const val = parseFloat(priceAZN);
    if (!isNaN(val) && val >= 0) {
      const minor = Math.round(val * 100);
      setPriceMinor(minor);
      setValidationError(null);
    } else {
      setValidationError("Zəhmət olmasa düzgün məbləğ daxil edin.");
    }
  }, [priceAZN]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) return;
    onSave(priceMinor);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md p-6 bg-slate-950 border border-slate-800 rounded-2xl space-y-6">
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">
          Saatlıq Meydança Tarifi
        </label>
        
        {/* Dynamic High-Contrast Input Container */}
        <div className="relative flex items-center rounded-xl bg-slate-900 border border-slate-800 focus-within:border-indigo-500 transition-colors duration-150">
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceAZN}
            onChange={(e) => setPriceAZN(e.target.value)}
            className="w-full h-13 px-4 bg-transparent text-lg font-semibold text-slate-100 placeholder-slate-600 focus:outline-none"
            placeholder="0.00"
            disabled={isLoading}
          />
          <div className="pr-4 flex items-center gap-2 border-l border-slate-800 pl-4 h-6">
            <span className="text-sm font-bold text-slate-300">AZN</span>
          </div>
        </div>
      </div>

      {/* Spacious Conversion Display Panel */}
      <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-900/40 border border-slate-900">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wide">
            Verilənlər Bazası
          </span>
          <p className="text-lg font-bold text-slate-300 tabular-nums">
            {priceMinor.toLocaleString()} <span className="text-xs text-slate-400">qəpik</span>
          </p>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wide">
            Ortalama Paylaşım (2v2)
          </span>
          <p className="text-lg font-bold text-indigo-400 tabular-nums">
            {(priceMinor / 4 / 100).toFixed(2)} <span className="text-xs text-slate-400">AZN</span>
          </p>
        </div>
      </div>

      {validationError && (
        <p className="text-xs font-semibold text-rose-500">{validationError}</p>
      )}

      <button
        type="submit"
        disabled={!!validationError || isLoading}
        className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-100 text-sm font-bold rounded-xl shadow-lg hover:shadow-indigo-500/10 transition-all duration-150"
      >
        {isLoading ? "Yadda saxlanılır..." : "Tarifi Təsdiqlə"}
      </button>
    </form>
  );
}
```

---

## ♿ 6. Accessibility & Cognitive Ergonomics Charter

To preserve startup-grade premium quality for Baku padel players, this Charter establishes rules for all future design iterations:

### 6.1 Contrast Ratio Verification (WCAG 2.2 AA)
- **Text & Core Indicators**: Must respect a minimum contrast ratio of **4.5:1** against backgrounds.
- **Interactive Boundaries**: Buttons, borders, inputs, and chip borders must maintain a minimum contrast ratio of **3:1** against background canvas levels.

### 6.2 Target Click Elements
- Every clickable item, list row, profile toggle, or selector button must have a minimum interactive height and width of **44 pt** in SwiftUI and **48 px** in Next.js Tailwind styles to prevent tapping mistakes.

### 6.3 VoiceOver & Screen Readers
- SwiftUI components must provide clean system definitions using `.accessibilityLabel` and `.accessibilityHint` properties in pure, organic Azerbaijani or English language formats.
- Avoid exposing technical IDs or database strings (such as `game_id` or `uuid`) to screen readers.

### 6.4 Cultural Nuance Localizations
- Traditional Azerbaijani racket sports athletes have high expectations for politeness.
- **Harsh Machine Terms**: Avoid direct translations like *"Bunu etməyin"* (Do not do this) or *"Uğursuz oldu"* (Failed).
- **Premium Organic Phrases**: Replace with polite variations: *"Zəhmət olmasa daxil etdiyiniz məlumatları yoxlayın"* (Please verify your details) or *"Əməliyyat tamamlanmadı"* (Transaction not completed).

---

## 📈 7. Verifiable Success Criteria & Continuous QA Plan

To measure and verify UX enhancements systematically, the platform will track these metrics following rollout:

```
                           ROLLOUT METRIC TARGETS
  ┌─────────────────────────────┼─────────────────────────────┐
  ▼                             ▼                             ▼
[Onboarding Retention]       [B2B Task Efficiency]         [Wallet Split-Error Rate]
Target: > 94%                Target: < 45 seconds          Target: 0.00%
- Metric: Completion Rate    - Metric: CourtSlot creation  - Metric: Typo-induced voids
- Target (Age 46+): > 88%    - Target (Bright outdoor): 98%- Target (Rounding gaps): zero
```

1. **Onboarding & Calibration Completion Rate**:
   - *Target*: $\ge 94\%$ overall completion rate from first OTP request to final ELO assignment.
   - *Seniors (Age 46+)*: $\ge 88\%$ completion rate, showing zero attrition during ELO calibration step.
2. **B2B Task Efficiency under High Ambient Light**:
   - *Target*: Club managers at Sea Breeze or Boulevard Padel must be able to complete a standard slot price recalculation or campaign creation in **under 45 seconds** on mobile tablets in bright outdoor environments.
3. **Wallet Split-Error Rate**:
   - *Target*: zero discrepancies. 100% of double bookings must be avoided via GiST temporal exclusions, and typo-induced pricing voids (misinterpreting qəpik and AZN formats) must be eliminated through the visual dynamic pricing form.
