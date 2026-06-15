# Tournaments tab — from-scratch rebuild ("Yarışlar" competitions hub)

**Date:** 2026-06-15 · **Branch:** `ideal/core-loop-and-social` · **Approved direction** (visual mockup) by owner.

## Goal
Replace the generic "PremiumPageHero + Upcoming/Live/Past segmented list" (same pattern as every other tab) with a distinctive **Competitions destination** — flagship for rebuilding all tabs. Must feel premium, padel-native, and not AI-generic. Azerbaijani-first (az/en/ru).

## Data reality (grounding — no faking)
- `Tournament` (list): id, name, description, venue_name, starts_at, ends_at, registration_deadline, max_squads, squad_size, entry_fee_minor, currency, status, entries_count.
- Statuses: `registration_open`, `registration_closed`, `in_progress`, `completed`, `cancelled`. Server buckets: `upcoming` / `live` / `past`.
- `TournamentDetail` adds entries[], my_entry, can_register. Endpoints: list (bucketed), detail, register/withdraw squad, sign-waiver. Americano lives under `/api/v1/americano/*`.
- **No "my tournaments" endpoint** and no `my_entry` on the list → the "Sənin yarışların" strip is **deferred** (needs a backend `/me/tournaments`). **Standings / brackets / winner / prize** are **not** in the API → "Nəticələr" shows completed tournaments + entries; real results light up only when backend ships them. **Liqa (leagues)** = "tezliklə" entry-point (backend-gated).

## Architecture
- **`TournamentsViewModel`** (enhanced, same class name so HomeView wiring is untouched): `load()` now fetches **all three buckets concurrently** → `live`, `registration` (upcoming), `past` arrays + an overall `ViewState`. `featured` = first `live` else soonest `registration_open` (excluded from its section to avoid dup).
- **New components** (one purpose each, in `Features/Tournaments/`):
  - `FeaturedTournamentHero` — royal-blue immersive card: name, venue, countdown to start/deadline, filling bar (`entries_count/max_squads`), entry fee, "Qoşul" → detail.
  - `CompetitionFormatRail` — three entry pills: Americano (→ `AmericanoTournamentView`), Turnir (active), Liqa (`tezliklə`, disabled).
  - `CompetitionCard` — premium status-driven card: venue thumb, name, date, filling bar, entry fee, status pill (reuses the existing status→label/color logic).
  - `CompetitionSection` — titled section wrapper (Canlı / Qeydiyyat / Nəticələr), hides when empty.
- **`TournamentsView`** — native `.navigationTitle("tournaments.title")` (large), scroll of: format rail → featured hero → sections. Pull-to-refresh. Keeps `TournamentRoute.detail` navigation + the iPad `AdaptiveSplit` (detail pane). Removes `PremiumPageHero` + the segmented `bucketPicker` (the double-chrome the audit flagged).

## Reuse / removals
- Reuse `CachedAsyncImage`, `DSColor`, `DSType`, `DSSpacing`, status label/color helpers, `AdaptiveSplit`, `TournamentDetailView`.
- Old `TournamentsView` body (hero + bucketPicker + old rows) is replaced; dead helpers removed.

## Acceptance
Build green; tab shows featured hero + format rail + status sections from live data; empty/loading/error states; no faked results/strips; localized; honors Reduce Motion; status pills use existing tokens. Verify with a simulator screenshot of the Tournaments tab.
