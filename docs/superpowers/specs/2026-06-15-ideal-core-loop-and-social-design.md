# Linkfit iOS — "Ideal" Core Loop + Social Pass

**Date:** 2026-06-15
**Branch:** `ideal/core-loop-and-social`
**Goal (from owner):** Bring the iOS app to an ideal, fully-functional, beautifully-polished state. Focus the **core loop** (discover → book court → find players/games → play → record score) AND the **social layer** (stories, follow/unfollow, feed, profile). First close functional gaps, then a full polish pass. Inspired by top global apps (Playtomic for booking/matchmaking, Instagram for social). Must feel very comfortable and must NOT look AI-generated. Execution: autonomous.

---

## Phase 0 — Ground truth (DONE)

| Fact | Finding |
|------|---------|
| **App maturity** | 1315 Swift files, 44 features, MVVM + strict design system (FAZA 45). Independent audit rated core flows ~4.5/5, production-grade. |
| **Design language** | Royal-blue `#5662D9` accent, lime-yellow `#DCF166` secondary, adaptive light/dark via `DSColor`. Strict rules already ban uppercase + letter-tracking (the main "AI-app" tells) — anti-generic is already a core principle. |
| **Backend** | iOS targets the **Node API** at `http://142.93.100.82` (live droplet), configured via `APIBaseURL` in `Info.plist`. |
| **`apps/api-laravel/`** | **Abandoned skeleton** — only `vendor/` + `.env`, no `app/`, `routes/`, `composer.json`, or `artisan`. NOT the live backend. Flag for cleanup; do not wire to it. |
| **Build** | Scheme `Linkfit`. **Was failing locally** due to a stale SPM artifact path (`Desktop/linkfit` → project moved to `Desktop/Projects/linkfit`); Sentry xcframework reference was stale. **Healed** by package re-resolution; clean build now produces `Linkfit.app`. |
| **Runtime** | App launches on iPhone 16e simulator (`az.linkfit.app`), renders a real logged-in Home with live data (stories, nearby players/clubs, upcoming-games empty state). Premium, restrained, not AI-looking. |
| **Deep links** | `linkfit://g/<id>` game, `linkfit://v/<id>` venue, `linkfit://u/<id>` profile, `linkfit://t/<id>` thread, `linkfit://r/<code>` referral, `linkfit://tournaments/<id>`, `linkfit://squads/<id>`, `linkfit://matchmaking`. Usable for headless screenshot verification via `simctl openurl`. |
| **Stories dark-mode** | `preferredColorScheme(.dark)` on StoryCamera/Creator/Editor/Viewer/DrawCanvas + PhotoCrop is **intentional and correct** (matches Instagram/Snapchat). `MembershipView` dark-lock is the only one worth re-examining. Do NOT blind-"fix" the story lock. |

### Verification harness available
- Clean build: `xcodebuild -project apps/ios/Linkfit.xcodeproj -scheme Linkfit -destination 'platform=iOS Simulator,name=iPhone 16e' -derivedDataPath apps/ios/build/dd build`
- Run: `simctl install` + `simctl launch az.linkfit.app`
- Screenshot: `simctl io <udid> screenshot out.png`
- Navigate (headless): `simctl openurl <udid> "linkfit://v/<id>"`

---

## Team (10 roles → agents)

Tech Lead/Orchestrator (main loop), Product Owner, iOS Architect, UX Lead, UI/Visual Designer, iOS Dev × Discover/Book/Find/Play-Score, QA. Audit fans out in parallel (one specialist per cluster); implementation is driven iteratively with green-build gates.

## Execution principle
Every change keeps the build green and is verified (build + targeted simulator screenshot where it touches UI). Findings are verified before they are fixed — no blind application of audit suggestions.

---

## Master gap list (from team audit)

**Audit result:** 93 verified findings (3 P0, 30 P1, 34 P2, 26 P3) across 10 clusters. Tech-Lead verdict: the app is *not* broken screen-by-screen — it is **disconnected at the wiring layer**. Many complete, polished features have **no entry point**; the dead/disconnected code is the #1 thing that makes the repo read as "AI-churned" (directly relevant to the owner's "must not look AI" requirement). Raw findings: `/tmp/lf_findings.json`; master plan: `/tmp/lf_master.json`.

### Execution batches (verified, each green-keeping)

- **Batch 1 — Quick correctness (single-file edits):** registration password policy 6→12 mismatch (`RegisterView`/`AuthViewModel`); venue-picker fake 4.8★ rating (`BookCourtView`); Home nested Button in ClubCard; tab-bar blur hardcoded Light → adaptive.
- **Batch 2 — P0 account access + App Store compliance (additive mounting):** mount `EmailVerificationBanner` + `verify-email` deep link; chain `ForgotPasswordView → ResetPasswordView` + `reset` deep link; wire `SettingsView` "Delete account" → real `PrivacyView` (Apple requires in-app deletion).
- **Batch 3 — Orphaned-feature entry points:** Matches `+` menu (one-off + `RecurringGameSheet` + `Americano`); `MembershipView` paywall row; `SessionsView` "logged-in devices" row; `GameDetailView` host invite (`InvitePlayerSheet`); group-chat entry buttons; consolidate referrals.
- **Batch 4 — Localization for newly-reachable screens:** `book.bucket.*`, Americano `americano.*`, `game.detail.open_slot`; az/en/ru coverage.
- **Batch 5 — Core-loop correctness:** booking duration-overflow guard; rate-CTA `status==.completed` + `has_rated` gating; render Friend-activity (or delete fetch); calendar day-sheet routing.
- **Batch 6 — Social reward + integrity:** squad-invite accept loop; "Follows you" pill; inline-unfollow confirmation; ELO delta through `FinalResultCard`/share card (backend-gated — else remove dead plumbing); group-chat parity.
- **Batch 7 — Design-system root-cause polish (one fix → many sites):** `SpringPressStyle` + haptic on `PrimaryButton` (~18 sites incl. mislabeled VenueDetail "Book"); `SegmentedPicker` double-haptic; haptic-ladder consolidation.
- **Batch 8 — Visual consistency + dead-code purge:** drop reused auth background on in-app/social/Feed surfaces; Reduce-Motion fixes; **delete dead code** (orphaned shell files, ~250 unused VenueDetail lines, duplicated quickStarts) — biggest "AI-churned" smell.

**Story overlay flatten (P0)** and **Tournaments prize/results** are larger, partly backend-gated efforts tracked separately.

### Progress log

Landed on `ideal/core-loop-and-social` (all build-green, committed):

- `186c5c0` **Batch 1** — registration password 6→12 CTA mismatch + honest strength meter; tab-bar blur → adaptive (dark mode); un-nest ClubCard double-Button (+ `SpringPressStyle`); stop fabricating 4.8★(12) for unrated venues.
- `0fdb5ba` **Batch 2 (P0 / compliance)** — password reset chains to `ResetPasswordView` via the existing `PasswordResetFlow` (was a dead-end toast); "Delete account" → real `PrivacyView` (Apple in-app-deletion requirement); mounted `EmailVerificationBanner` on Home (was unreachable — **verified live in simulator**). Removed dead "coming soon" alert + `ComingSoonMessage`.
- `bb5f7ef` **Batch 7a** — `PrimaryButton` + `FollowButton` press-scale + haptic (root-cause, ~18 CTAs); removed 2 redundant per-site haptics.
- `6f26663` **Social** — inline-unfollow now uses the overflow menu's confirmation; surfaced Home `friendActivitySection` (fetched but never rendered).
- `be0553c` **#19** — booking can no longer overflow venue close (9:00–22:00): overflow start-times disabled, selection cleared when duration grows.

**Remaining** (high value): orphan entry points needing localized titles (Membership/Sessions rows, Americano/Recurring via Matches `+` menu, host invite, group-chat entries); story-overlay flatten (P0 quality); ELO delta (backend-gated); squad-invite accept; rate-CTA gating; dead-code purge. See the "Remaining" section of the master gap list above.
