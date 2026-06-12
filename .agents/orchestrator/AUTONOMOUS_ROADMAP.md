# Linkfit Autonomous Roadmap & Baku Padel Backlog

This document establishes the **Autonomous Roadmap & Brainstorming Backlog** for the Linkfit platform under the **FULL AUTONOMOUS STARTUP MODE** mandate. It coordinates input from CEO/Founders, Product Owners, marketing specialized swarms, and engineering groups to detail future Milestones (M10, M11, M12, M13) and premium Baku Padel features.

---

## 📅 Milestones Roadmap (M10 - M13)

| Milestone | Title | Focus Area | Status | Target Launch |
|---|---|---|---|---|
| **M10** | Smart Matchmaking Engine | Concurrency & ELO Algorithms | **PLANNED** | June 2026 |
| **M11** | Venue Discount Integrations | Remote Push & API Webhooks | **PLANNED** | July 2026 |
| **M12** | Interactive Leaderboards & Scoring | PostgreSQL DB & iOS UI | **PLANNED** | August 2026 |
| **M13** | Viral Referral Growth Engine | Growth Hacking & Cashbacks | **PLANNED** | September 2026 |

---

## ⚡️ Brainstorming & Technical Tickets

### 🎾 Milestone M10: Smart Matchmaking (Doubles/Singles Queue Optimization)
- **Product Objective (PO)**: Players in Baku (e.g. at Sea Breeze or Boulevard Padel) need a fast, autonomous matchmaking system that dynamically groups players into singles (1v1) or doubles (2v2) based on ELO ratings and location proximity.
- **ASO & Marketing Copy**: 
  - **AZ**: *"Saniyələr içində padel yoldaşı tap! Təkli (1v1) və ya Cütlü (2v2) oyunlar üçün intellektual ELO uyğunlaşdırılması."*
  - **EN**: *"Find your padel partner in seconds! Intelligent ELO-based matchmaking for singles (1v1) and doubles (2v2) matches."*
- **Technical Ticket (CTO/Lead Engineer)**:
  - **Fastify/Kysely API backend**: 
    - Implement matching queue table `matchmaking_queue` mapping `user_id`, `court_type` ('singles' | 'doubles'), `elo_rating`, `latitude`, `longitude`, `joined_at`.
    - Create a background job utilizing PostgreSQL pessimistic locking (`FOR UPDATE`) to match 2 or 4 players within an ELO threshold (`±150`) and proximity boundary (`earth_box` search).
  - **SwiftUI Client**:
    - Update `MatchesView.swift` to add a "Maksimal Sürətli Oyun Tap (Smart Match)" button with a pulsing circular animation.
    - Connect to server WebSocket / SSE endpoint for live queue status ticks (*"Uyğun oyunçu axtarılır... [1/4]"*).

---

### 🔔 Milestone M11: Baku Padel Clubs Direct Discount Notifications
- **Product Objective (CEO & Marketing)**: Partner with top-tier clubs (Sea Breeze Padel, Baku Padel, Boulevard Gyms) to push time-sensitive court discounts (e.g., 20% off off-peak hours) directly to nearby active players.
- **ASO & Marketing Copy**:
  - **AZ**: *"Baku Padel və Sea Breeze-dən son dəqiqə endirimləri! Kortlarda oynamaq indi daha sərfəli."*
  - **EN**: *"Last-minute discounts from Baku Padel and Sea Breeze! Premium court play now even more accessible."*
- **Technical Ticket (DBA & Integration Specialist)**:
  - **Fastify API Backend**:
    - Add a `venue_discounts` table with fields `id`, `venue_id`, `discount_percentage`, `promo_code`, `valid_until`, `created_at`.
    - Create a push worker (`apps/api/src/modules/discounts/discounts.service.ts`) that triggers APNS notifications using Azerbaijani localization keys in `push.templates.ts`:
      - `"discount.club"`: `az`: `"Klub Endirimi"`, body: `"{venue_name} kortunda {percentage}% endirim! Promo kod: {code}"`.
  - **SwiftUI Client**:
    - Integrate dynamic push handling in `DeepLinkRouter.swift` mapping `"linkfit://discounts/{id}"` directly to a clean pop-up modal showing the discounted venue with continuous curved paddings (`p-6`).

---

### 🏆 Milestone M12: Post-Match Scoring & ELO Leaderboards
- **Product Objective (PO & Agile PM)**: Gamify the player community in Baku with weekly leaderboards, user streak badges, and verified scoring inputs signed off by both match captains.
- **ASO & Marketing Copy**:
  - **AZ**: *"Reytinqini yüksəlt, Bakının bir nömrəli padel ustası ol! Hər oyundan sonra xallarını qazan."*
  - **EN**: *"Climb the ranks and become Baku's absolute padel master! Earn points after every match."*
- **Technical Ticket (DBA & SwiftUI Developer)**:
  - **PostgreSQL / Kysely**:
    - Add indexing for fast rank queries: `CREATE INDEX idx_users_elo ON users (elo_rating DESC)`.
    - Implement a `match_scores` schema verifying captain submissions to prevent score fraud.
  - **SwiftUI Client**:
    - Build a premium, high-contrast leaderboard screen in `ProfileView.swift` displaying top players in Baku with native streak flame icons and user badges.
    - Implement custom transition spring curves for smooth rank animations.

---

## 📈 Milestone M13: Referral Growth Hacking & Cashbacks
- **Product Objective (Growth Hacker & CEO)**: Drive viral loops across Baku by offering automatic cashbacks (e.g., 5 AZN credit in Linkfit Wallet) for both the inviter and referee once the referee completes their first booking.
- **ASO & Marketing Copy**:
  - **AZ**: *"Dostunu dəvət et, hər ikiniz 5 AZN qazanın! Padel zövqünü birlikdə bölüşün."*
  - **EN**: *"Invite your friends, both earn 5 AZN! Share the premium padel experience together."*
- **Technical Ticket (API & DBA)**:
  - **Fastify API Backend**:
    - Add `user_wallets` and `wallet_transactions` tables to manage user balances in qəpik (e.g., `500` representing 5.00 AZN).
    - Implement transaction checks with pessimistic locking on user wallets during cashback payouts.
  - **SwiftUI Client**:
    - Refactor `InviteFriendsView.swift` to add a live "Dəvət Balansım" counter with elegant light-mode contrast card layouts.

---

## 🔒 Strict Compliance & CPU Silence Rules

1. **Docker-less Mandate**: Strict prohibition on local docker compose/daemon operations. All remote database tables and schema verifications are handled remotely.
2. **CPU & Fan Noise Throttle**: Sequential builds only, cool-down timers enabled, and zero Playwright/Vitest automated runs on the local CPU.
3. **Continuous Deployment Ready**: All backend, Next.js dashboard, and iOS modules remain 100% compilation-clean and ready for immediate continuous integration (CI) deployment.
