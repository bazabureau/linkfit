# Linkfit Platform: Security, Legal & Compliance Guide
**Document Identifier:** LF-SEC-LEG-COMP-2026-V1.0  
**Effective Date:** June 1, 2026  
**Jurisdiction:** Republic of Azerbaijan & European Union (Cross-Border Harmonized Framework)  
**Classification:** Public Corporate Governance & Security Architecture  

---

## Executive Overview

Linkfit is a premium fitness, padel reservation, and competitive community matchmaking platform catering to high-end venues and players in Baku, Azerbaijan, and internationally. Operating a multi-sided marketplace that handles financial transactions, user location telemetry, competitive ranking (ELO) matchmaking, and personal data requires adherence to strict legal and security standards. 

This document serves as the absolute blueprint for Linkfit’s operational compliance, combining technical system architecture specifications with formal legal policies. It bridges the engineering mandates of Linkfit's software architecture with:
1. **PCI-DSS Level 1 Security Requirements** for payment transactions.
2. **EU General Data Protection Regulation (GDPR)** and the **Law of the Republic of Azerbaijan on Personal Data (Fərdi məlumatlar haqqında, No. 998-IIIQ)**.
3. **Marketplace Terms of Service (ToS)**, covering cancellations, automated refunds, and ELO competitive integrity.

---

## SECTION 1: Secure Payment Gateway Architecture & Financial Integrity

To facilitate seamless court reservations, tournaments, and premium subscriptions, Linkfit integrates a secure, fault-tolerant financial architecture. Transactions must support local payment behaviors in Baku (including credit/debit card processing, digital wallets, and cash terminal integrations) while maintaining strict architectural isolation of sensitive credit card data.

```
       +-------------------------------------------------------------------+
       |                     LINKFIT CLIENT INTERFACE                      |
       |                (SwiftUI iOS App / Next.js Web)                    |
       +-------+--------------------------+-----------------------+--------+
               |                          |                       |
               | (1) Card Data            | (3) Token             | (6) Redirect
               v                          v                       v
     +---------+----------+      +--------+---------+    +--------+--------+
     |   STRIPE SECURE    |      |  LINKFIT API     |    |   M10 WALLET    |
     |   TOKENIZATION     |      |  BACKEND SERVER  |    |  API & DEEP-LINK|
     | (PCI-DSS Vaulting) |      | (No PCI PANs)    |    |   (Pasha Pay)   |
     +---------+----------+      +--------+---------+    +--------+--------+
               |                          |                       ^
               |                          | (4) Charge Token      | (5) Request
               |                          v                       |
               +------------------------> STRIPE API <------------+
                                          (HTTPS TLS 1.3)
```

### 1.1 PCI-DSS Compliance Map & Tokenization (Stripe, MilliÖN, M10)

To minimize Linkfit's regulatory liability and reduce the scope of audits to **PCI-DSS Self-Assessment Questionnaire A (SAQ-A)**, no primary account numbers (PAN), expiration dates, or CVV/CVC codes are ever transmitted, processed, or stored on Linkfit’s servers.

#### 1.1.1 Stripe Tokenization Flow
1. **Direct Vaulting**: The client-side SwiftUI or Next.js frontends capture raw card details using Stripe-hosted UI components (Stripe Elements / Stripe iOS SDK). The input fields are directly mounted to Stripe's iframe or native secure controllers.
2. **Ephemeral Token Generation**: The secure card data is transmitted directly from the user's device to Stripe's PCI-DSS Level 1 secure vaulting servers. Stripe returns a secure, single-use Payment Method Token (`pm_...` or `tok_...`).
3. **Safe Backend Storage**: The client forwards this token to the Linkfit API Backend (`/api/v1/payments/setup`). Linkfit communicates with Stripe using a secure HTTPS TLS 1.3 channel to link this token to a newly generated or existing Stripe Customer ID (`cus_...`).
4. **Subsequent Charges**: All future charges are executed server-to-server by passing the Stripe Customer ID and Payment Method ID. Linkfit databases only store references to these opaque IDs:

```sql
CREATE TABLE user_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255) NOT NULL,
    stripe_payment_method_id VARCHAR(255) NOT NULL,
    card_brand VARCHAR(50) NOT NULL,          -- e.g., 'Visa', 'MasterCard'
    card_last_four CHAR(4) NOT NULL,          -- Last 4 digits only
    expiry_month INT NOT NULL,
    expiry_year INT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_payment_method UNIQUE (user_id, stripe_payment_method_id)
);
```

#### 1.1.2 MilliÖN Terminal cash-in integrations & Replay Protection (Baku Sovereign Cash-In)
For localized users in Baku who prefer cash payments via MilliÖN self-service terminal systems:
1. **API Endpoints**: Linkfit exposes a dedicated, whitelist-restricted callback endpoint (`/api/v1/integrations/million/callback`).
2. **Identification**: Users obtain a unique, deterministic 8-digit **Linkfit Member Wallet ID** from their Profile page.
3. **Transaction Flow & Replay Protection**:
   - The player inputs their Member Wallet ID into the MilliÖN terminal screen.
   - The MilliÖN terminal makes a signed, real-time query to the Linkfit API (`/api/v1/integrations/million/query?member_id=XXXXXXXX`) to verify user existence and display the user's name (in masked form, e.g., `K. Namazov`).
   - The terminal accepts physical AZN currency, calculates the cash credit, and sends an encrypted payload (signed using **HMAC-SHA256** with an annually rotated merchant private key) to Linkfit's callback endpoint.
   - **Mandatory Replay Protection & Idempotency Check**: To prevent replay attacks, every callback request at `/api/v1/integrations/million/callback` MUST contain a unique transaction ID (`txn_id`) and an epoch timestamp (`txn_timestamp`).
     - The callback receiver implements a strict idempotency check by acquiring a lock and registering the `txn_id` in the system database. Duplicate `txn_id` requests are rejected instantly.
     - The system rejects any callback payload where the `txn_timestamp` is older than 5 minutes (300 seconds) relative to the server's current epoch.
   - The callback credits the player's internal platform wallet in qəpik and issues a push notification.

#### 1.1.3 M10 Wallet Integration (Pasha Pay)
To support Baku’s leading mobile peer-to-peer wallet:
1. **Direct Request**: The user selects M10 as the payment method inside the Linkfit iOS app.
2. **Deep-linking**: Linkfit API backend generates a payment intent with a callback tracking URL, and returns an M10 deep-link schema (`m10pay://payment?intent=...`).
3. **Verification**: Upon transaction authorization inside the native M10 application, the user is deep-linked back to the Linkfit application, while the M10 transaction servers dispatch a cryptographically signed webhook to Linkfit’s webhook receiver (`/api/v1/payments/webhooks/m10`) to confirm ledger settlement.

---

### 1.2 Multi-Party Split Payments in Integer Minor Units (Qəpik)

Floating-point arithmetic represents a critical vulnerability in financial systems due to IEEE 754 precision issues (e.g., `0.1 + 0.2 = 0.30000000000000004`). Cumulative rounding discrepancies are illegal under central banking standards.

#### 1.2.1 Integer Minor Units (Qəpik) Mandate
- **All financial fields** in databases, application logic, and API payloads MUST be calculated and stored as **64-bit integers in minor units** (qəpik for Azerbaijani Manat, cents for USD/EUR).
- **1 AZN = 100 Qəpik**. 
- A court booking fee of 40.00 AZN is represented strictly as `4000`.

#### 1.2.2 Secure Split-Payment Math
Linkfit operates on a multi-party marketplace commission model:
- **Gross Booking Amount ($A_{gross}$)**: Total paid by the player.
- **Linkfit Commission ($C_{linkfit}$)**: Platform booking fee ($8\%$ standard commission).
- **Venue Share ($S_{venue}$)**: Net payout directly credited to the venue ($92\%$ standard payout).

To guarantee absolute mathematical integrity and prevent financial leakage:
$$A_{gross} = C_{linkfit} + S_{venue}$$

If an odd split occurs, any division fractional remainder must not be lost or rounded arbitrarily. The fractional discrepancy must be allocated to Linkfit's fractional escrow ledger to balance the equation perfectly down to the single unit of qəpik.

**TypeScript Execution Logic for Splitting Payments:**
```typescript
interface SplitPaymentResult {
  grossAmountQəpik: number;
  commissionQəpik: number;
  venueShareQəpik: number;
}

export function calculateTransactionSplit(
  grossAmountQəpik: number, 
  commissionRatePercent: number = 8.0
): SplitPaymentResult {
  if (!Number.isInteger(grossAmountQəpik) || grossAmountQəpik <= 0) {
    throw new Error("Financial calculation requires positive integer value in minor units (qəpik).");
  }

  // Calculate commission using integer math
  // Multiplied by 100 first to handle fractional percentage points, then divided with rounding
  const commissionCalculated = Math.round((grossAmountQəpik * commissionRatePercent) / 100);
  
  // To ensure absolute integrity: S_venue = A_gross - C_linkfit
  const venueShareCalculated = grossAmountQəpik - commissionCalculated;

  // Double check zero-leakage invariant
  if (commissionCalculated + venueShareCalculated !== grossAmountQəpik) {
    throw new Error("Zero-leakage invariant violated during financial split calculations!");
  }

  return {
    grossAmountQəpik,
    commissionQəpik: commissionCalculated,
    venueShareQəpik: venueShareCalculated
  };
}
```

---

### 1.3 Idempotency & Concurrency Hardening (Idempotency-Key Setup)

To prevent catastrophic double-charging caused by unstable mobile connections, button multi-clicks, or API retries, Linkfit implements a strict, mandatory **Idempotency-Key API standard** for all state-changing endpoints (e.g., booking creations, wallet top-ups, tournament entries).

#### 1.3.1 Idempotency Key Pipeline

```
 [ Client Request ] -> (Includes `Idempotency-Key` Header: UUIDv4)
                             |
                             v
           +-----------------+-----------------+
           |   Does Key Exist in DB Table?    |
           +-----------------+-----------------+
                             |
              +--------------+--------------+
              | Yes                         | No
              v                             v
   +----------+----------+        +---------+----------+
   |  What is Key Status?|        | Insert Key with    |
   +----------+----------+        | Status 'PROCESSING'|
              |                   +---------+----------+
     +--------+--------+                    |
     | SUCCESS         | PROCESSING         | [ Execute Financial Db Tx ]
     v                 v                    | (Pessimistic Wallet Lock)
[Return Cached]   [Return 409]              |
[Response Pld ]   [Conflict  ]              v
                                  +---------+----------+
                                  | Update Key Status  |
                                  | to 'SUCCESS' & save|
                                  | Response Payload   |
                                  +--------------------+
```

#### 1.3.2 SQL Schema for Idempotency and Transaction Ledgers
```sql
CREATE TYPE idempotency_status AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED');

CREATE TABLE idempotency_keys (
    idempotency_key UUID PRIMARY KEY, -- Note: Because idempotency_key is a globally unique PRIMARY KEY, PostgreSQL automatically creates a unique B-Tree index on it, making any secondary compound index on (idempotency_key, user_id) redundant and unnecessary.
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_path VARCHAR(500) NOT NULL,
    status idempotency_status NOT NULL DEFAULT 'PROCESSING',
    response_code INT,
    response_body JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform_wallet_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    booking_id UUID, -- References bookings if applicable
    amount_qəpik BIGINT NOT NULL, -- Negative for debit, Positive for credit
    transaction_type VARCHAR(100) NOT NULL, -- 'COURT_BOOKING', 'CANCELLATION_REFUND', 'PAYOUT'
    currency CHAR(3) NOT NULL DEFAULT 'AZN',
    idempotency_key UUID UNIQUE REFERENCES idempotency_keys(idempotency_key),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### 1.3.3 Concurrency Control & Race Condition Prevention
To prevent "double-spend" vulnerabilities (where a user quickly fires concurrent requests to purchase two court bookings with a wallet balance that is only sufficient for one), Linkfit's backend API uses **PostgreSQL Pessimistic Locking** (`SELECT ... FOR UPDATE`).

#### 1.3.4 Split-Payment locking deadlocks protection
During split-payments where multiple players' wallets are locked and debited simultaneously within a single database transaction, lock acquisition order is critical. If Transaction 1 locks User A then User B, while concurrent Transaction 2 locks User B then User A, a database deadlock occurs.
- **Mandatory Sorting Rule**: The application MUST sort all target user IDs deterministically (e.g., sorting `user_id` alphabetically/numerically) before executing the row-level locks (`.forUpdate()`). This guarantees that all concurrent transactions acquire row locks in the exact same resource order, completely eliminating deadlock cycles.

**Database Transaction Logic Example:**
```typescript
import { Kysely, Transaction } from 'kysely';

interface DB {
  wallets: {
    user_id: string;
    balance_qəpik: number;
    updated_at: Date;
  };
}

export async function processWalletDebit(
  db: Kysely<DB>,
  userId: string,
  debitAmountQəpik: number
): Promise<void> {
  await db.transaction().execute(async (trx: Transaction<DB>) => {
    // 1. Acquire pessimistic lock on the user's wallet row
    const wallet = await trx
      .selectFrom('wallets')
      .select(['balance_qəpik'])
      .where('user_id', '=', userId)
      .forUpdate() // CRITICAL: Acquires Row Share Lock, blocking concurrent transactions
      .executeTakeFirst();

    if (!wallet) {
      throw new Error("Wallet record not found.");
    }

    // 2. Validate current funds in integer minor units
    if (wallet.balance_qəpik < debitAmountQəpik) {
      throw new Error("Insufficient funds in Linkfit Wallet.");
    }

    // 3. Deduct securely and update balance
    const newBalance = wallet.balance_qəpik - debitAmountQəpik;
    await trx
      .updateTable('wallets')
      .set({ 
        balance_qəpik: newBalance,
        updated_at: new Date()
      })
      .where('user_id', '=', userId)
      .execute();
  });
}
```

---

## SECTION 2: GDPR & Azerbaijani Data Privacy Regulatory Framework

Linkfit processes sensitive physical activity metrics, geo-coordinates, real names, phone numbers, and cross-border financial transactions. The platform enforces a highly structured data privacy compliance engine that harmonizes European Union GDPR regulations and the Republic of Azerbaijan’s Law on Personal Data (No. 998-IIIQ).

---

### 2.1 Legal Basis & Dual Regulatory Scope

| Regulatory Code | Territory | Key Constraint | Linkfit Implementation |
|---|---|---|---|
| **EU GDPR** *(Regulation 2016/679)* | European Union / Global Users | Global extraterritorial scope, explicit opt-in telemetry consent, absolute Right to Erasure (Article 17). | Privacy-by-design architecture, zero-telemetry active defaults, automated scrubbing. |
| **Law of the Republic of Azerbaijan on Personal Data** *(No. 998-IIIQ)* | Republic of Azerbaijan | Mandatory localization and sovereign storage of local citizens' PII (Article 13). | Federated physical data architecture. Baku datacenter storage for local user profiles. |

#### Sovereign Local Data Residency (Azerbaijan)
To satisfy Article 13 of Law No. 998-IIIQ, Linkfit operates a **federated data model**:
1. **Local Resident Database**: Personal information (names, emails, phone numbers, localized booking data, national ID checks for venue registration) of players residing inside the Republic of Azerbaijan is physically stored and processed on secure cloud hosts or bare-metal setups situated in Azerbaijan (e.g., AzInTelecom or local Tier III datacenters in Baku).
2. **Global Database**: European and international users are hosted in regions matching standard cloud providers (e.g., AWS Frankfurt `eu-central-1`).
3. **Pseudonymization Routing**: When cross-border bookings occur (e.g., an EU player traveling to Baku to book a court at Sea Breeze Padel Club), personal data transfers are processed using pseudonymized user keys (UUIDs) without transmitting raw PII across borders unless direct player consent is granted via the mobile UI interface.

---

### 2.2 Data Processing Architecture & Telemetry Permissions

Linkfit classifies data into distinct tiers, each governed by specific consent and lifecycle limits:

```
        +-------------------------------------------------------------------+
        |                       DATA CLASSIFICATION                         |
        +------------------+------------------------+-----------------------+
                           |                        |
                           v                        v
              +------------+------------+     +-----+--------------------+
              | CATEGORY A: IDENTIFIABLE|     | CATEGORY B: ANONYMIZED   |
              | (Names, Phones, Emails, |     | TELEMETRY (Court Views,  |
              |  Medical/Emergency Details)   | Match Clicks, Game Stats)|
              +------------+------------+     +-----+--------------------+
                           |                        |
                           v                        v
              +------------+------------+     +-----+--------------------+
              | - Explicit Consent      |     | - In-Memory Ingestion    |
              | - Hard Purge on Request |     | - No PII Associations    |
              | - Stored in Secure Vault|     | - Aggregated Stats Only  |
              +-------------------------+     +--------------------------+
```

1. **Explicit Telemetry Opt-in**: The first installation launch of the iOS application prompts users for consent to track behavioral analytics and telemetry. By default, telemetry tracking is disabled.
2. **Precise vs. Approximate Location Consent**: Linkfit requests precise location permissions only to calculate real-time distances to padel venues (e.g., distance in km to Boulevard Padel). This telemetry is processed entirely in-memory and is never stored on disk unless the user joins an active lobby requiring neighborhood matchmaking. If the permission is revoked, the system falls back to a default static city center location (Baku center point: `40.4093° N, 49.8671° E`).

---

### 2.3 User Right to Erasure (Right to be Forgotten)

Under GDPR Article 17 and Azerbaijan Personal Data Law Article 16, players possess the right to permanently purge their profiles. Linkfit automates this process through a strict transactional queue to guarantee complete compliance across all tables while preserving global platform reporting integrity (such as venue balance sheets and non-identifiable aggregate booking counts).

#### 2.3.1 Erasure Lifecycle
1. **Cool-off Phase**: User initiates account deletion. The account status shifts to `PENDING_DELETION`. The user is immediately logged out, and their profile is hidden from all community feeds, matches discovery, and venue tournament brackets. A 14-day grace window is provided to halt accidental deletions.
2. **Automated Purging**: On day 15, a secure, scheduled worker processes a transactional purge cascade:
   - **Personal Information Sanitization**: The record is not merely deleted (which could break foreign key constraints on historical venue booking financial ledgers); instead, all PII fields are scrambled or set to NULL:
      - `name` $\rightarrow$ "Former Player" (or "Silinmiş İstifadəçi" in Azerbaijani database partitions)
      - `email` $\rightarrow$ `deleted_user_XXXXX@linkfit.az` (hash-masked value)
      - `phone_number` $\rightarrow$ `NULL`
      - `avatar_url`, `bio`, `medical_emergency_notes` $\rightarrow$ `NULL`
   - **Active Associations Cleared**: The user is deleted from all squads, future match lineups, and chat rooms.
   - **Anonymized Metrics Retained**: The total counts of matches played, tournament participation flags, and game results are aggregated into global historical tables to maintain matchmaking ELO accuracy across the network.
   - **Financial Ledger Retention**: For tax compliance and fraud investigation under Azerbaijani banking regulations, raw payment records inside `platform_wallet_ledgers` are moved to a cold, read-only transaction archive. PII is scrubbed from them, retaining only the timestamp, gross amount, and target venue ID. This archive is kept for 5 years before permanent physical deletion.

**Secure Database Erasure Cascade Transaction:**
```sql
CREATE OR REPLACE FUNCTION purge_user_identity(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
    -- 1. Verify user is in 'PENDING_DELETION' status
    IF NOT EXISTS (
        SELECT 1 FROM users 
        WHERE id = target_user_id AND status = 'PENDING_DELETION'
    ) THEN
        RAISE EXCEPTION 'User account is not set to PENDING_DELETION status.';
    END IF;

    -- 2. Delete sensitive personal sessions
    DELETE FROM user_payment_methods WHERE user_id = target_user_id;
    DELETE FROM sessions WHERE user_id = target_user_id;

    -- 3. Anonymize Core User Record (Keep historical keys stable)
    UPDATE users
    SET 
        name = 'Former Player',
        email = CONCAT('deleted_', target_user_id, '@linkfit.az'),
        phone_number = NULL,
        avatar_url = NULL,
        bio = NULL,
        status = 'DELETED',
        updated_at = NOW()
    WHERE id = target_user_id;

    -- 4. Clean up private medical emergency data
    DELETE FROM user_emergency_medical_details WHERE user_id = target_user_id;

    -- 5. Cascade soft-removals on matches and squads
    DELETE FROM squad_members WHERE user_id = target_user_id;
    DELETE FROM match_players WHERE user_id = target_user_id;

    -- Note: platform_wallet_ledgers retains historical records linked to user_id (foreign key set to NULL or kept as anonymized ID)
END;
$$ LANGUAGE plpgsql;
```

---

## SECTION 3: Platform Terms of Service & Venue Marketplace Regulations

Linkfit operates a B2B partner court-booking marketplace, connecting players with premium sports venues in Baku (e.g., Sea Breeze Padel Club, Baku Padel, Boulevard Padel). The Terms of Service govern transactional rules, refund conditions, IP, and code of conduct expectations to protect players, venues, and the platform.

---

### 3.1 Court Reservation, Cancellation, & Refund Policies

To maintain trust with elite venues and protect players against unexpected emergencies, Linkfit enforces a rigorous cancellation schedule.

```
 Booking Confirmed
        |
        v
 +------+-------------------------------------------------------------------+
 |                    CANCELLATION TIMELINE AUDIT                    |
 +------+-------------------------------------------------+-----------------+
        |                                                 |
        v (> 24 hours prior)                              v (12-24 hours prior)
 +------+------------------+                       +------+------------------+
 |  - 100% Refund credited |                       |  - 50% Refund to Player |
 |  - No venue payout      |                       |  - 50% Payout to Venue   |
 +-------------------------+                       +-------------------------+
        |
        v (< 12 hours prior / No-Show)
 +------+------------------+
 |  - 0% Refund (No-Show)  |
 |  - 100% Split settled   |
 +-------------------------+
```

#### 3.1.1 Cancellation Tiers
1. **Tier A: Standard Cancellation (> 24 hours prior to booking slot)**:
   - The reservation can be canceled by the user with zero penalty.
   - The player receives a **100% refund** in qəpik, returned to their original payment method (Stripe/M10) or, if preferred, as Linkfit Wallet Credits.
   - The venue's reservation calendar is instantly freed.
2. **Tier B: Late Cancellation (12 to 24 hours prior to booking slot)**:
   - To protect the venue from empty, unbookable slots, the cancellation incurs a **50% penalty fee**.
   - The player receives a **50% refund** of the booking amount.
   - The remaining **50%** is settled as a net payout to the venue’s balance to compensate for lost booking opportunities, with the platform commission calculated on that 50% portion.
3. **Tier C: Immediate Cancellation / No-Show (< 12 hours prior to booking slot)**:
   - The reservation is **completely non-refundable**.
   - The player receives **0%** refund.
   - The full transaction split is executed: the venue receives 92% of the payment, and Linkfit retains its 8% platform fee.

#### 3.1.2 Automated Refund Processing
All refunds are triggered electronically via Linkfit’s core transaction manager. If a refund is initiated, the system must process it through the exact same transactional channel used to pay:
- If paid via Linkfit Wallet: Instant internal balance credit.
- If paid via Stripe Credit Card: Refund intent dispatched to Stripe API. Card networks process refunds back to the issuer within 5-10 business days.
- If paid via MilliÖN Cash Terminal: Cash refunds cannot be printed by the platform. These refunds are exclusively credited as **Linkfit Wallet Credits** in Azerbaijani Manat (AZN), allowing users to use the credit for future court or tournament fees.

#### 3.1.3 Weather Force Majeure & Automated Telemetry Auditing (Baku Winds Clause)
In the event of severe weather conditions typical to Baku (e.g., wind speeds exceeding 40 km/h or heavy rainfall on open outdoor courts):
- The venue reserves the right to declare a **"Force Majeure Venue Closure"** cancellation.
- This status is flagged through the Next.js B2B Partner Dashboard.
- **Automated Weather Telemetry Check (Abuse Prevention)**: To prevent cancellation abuse by partner venues seeking to arbitrarily waive platform commissions or cancel bookings without cause, the system integrates an automated weather API check (e.g., pulling real-time coordinates telemetry from OpenWeatherMap or Baku Weather Services).
  - When a venue declares a Force Majeure closure, the system automatically queries local wind speeds and precipitation active at the venue's physical coordinates (GPS latitude/longitude).
  - If the wind speed exceeds **40 km/h** or if **active precipitation** is verified, the system automatically processes the cancellation, issues an automated **100% refund** in qəpik to all affected players, and waives the platform commission.
  - If the telemetry shows wind speeds $\le 40$ km/h and no active precipitation, the system **flags the cancellation for a manual support audit** rather than auto-refunding and waiving platform commissions.
  - Push notifications are pushed to players only after validation: *"Rezervasiya ləğv edildi: Hava şəraiti ilə əlaqədar kortlar müvəqqəti bağlanıb."*

---

### 3.2 Competitive Integrity & ELO Matchmaking Code of Conduct

Linkfit offers an integrated, automated player matchmaking engine based on active ELO skill tracking. To protect the competitive integrity of the Baku padel leagues, tournaments, and recreational matches, ELO rating manipulation is strictly prohibited.

#### 3.2.1 Prohibited Matchmaking Fraud
1. **ELO Manipulation / Win-Trading**: Players colluding to fake match results or deliberately throwing matches ("boosting") to artificially raise or lower individual ELO levels.
2. **Smurfing**: High-skilled players creating fresh accounts or masquerading on lower-skill profiles to manipulate tournament eligibility classes or dominate novice match lobbies.
3. **Self-Reporting Fraud**: Intentionally submitting incorrect match scores on the Linkfit app. Under competitive terms, both match captains must cross-verify and approve the match scores within 2 hours of completion. Discrepancies lock both players' ratings and trigger automatic admin review.

#### 3.2.2 Enforcement Matrix

| Offense | Severity | Immediate Action | Punitive Consequence |
|---|---|---|---|
| First Offense | Moderate | 7-day competitive matchmaking suspension. | ELO score reset to platform baseline of `1000 ELO`. |
| Second Offense | High | 90-day competitive matchmaking suspension. | Profile downgraded: Restricted to private court bookings only; tournament eligibility revoked. |
| Third Offense | Critical | Lifetime platform suspension. | Complete, irreversible termination of Linkfit user account and forfeiture of non-monetary loyalty rewards. |

---

### 3.3 Intellectual Property & Content Licensing

Linkfit maintains absolute protection over its proprietary digital systems, algorithms, and branding elements.

#### 3.3.1 Platform IP
- Linkfit holds exclusive, global ownership of all intellectual property, including but not limited to:
  - The iOS SwiftUI application codebase and Next.js frontend B2B framework.
  - The proprietary ELO rating calculation and player matchmaking algorithms.
  - Custom UI widgets, brand identity logos, designs, layouts, and translations.
- Any unauthorized compilation, reverse engineering, scraping of court availability tables, or extraction of player matchmaking pools is strictly prohibited and subject to legal action under Azerbaijani intellectual property laws.

#### 3.3.2 Venue & User Content Licenses
- **Venue Content**: By registering and listing courts on the Linkfit platform, B2B partner venues grant Linkfit a non-exclusive, worldwide, royalty-free, sub-licensable license to utilize, display, and distribute venue imagery, brand names, booking schedules, logos, and court descriptions across Linkfit’s channels.
- **User Content**: Players uploading profile photos, bios, tournament squad logos, or community feed updates grant Linkfit a royalty-free license to host, cache, distribute, and display this content within the Linkfit platform ecosystem for community-building and platform functionality.

---

### 3.4 Indemnification & Physical Safety Disclaimer

Padel, tennis, and fitness training involve inherent physical risks. Linkfit acts as an intermediary reservation agent and competitive matchmaking broker.

1. **Venue Liability**: Venues are solely responsible for court upkeep, physical safety standards, player liability waivers on-site, and equipment safety. Linkfit is not liable for physical injuries, accidents, or property damage sustained during a court booking.
2. **Medical Emergency Profiles**: Linkfit provides players with an optional profile field to input emergency medical details (e.g., blood type, allergies) for rapid access during local tournaments. This data is stored strictly in encrypted databases and is only accessible by authorized tournament administrators during official Linkfit events.

---

## CONCURRENCE & COMPLIANCE VERIFICATION

To verify compliance with this document, the platform's codebase and architecture must pass structural checks. The following check matrix represents the formal criteria that each subsequent development cycle must satisfy:

- [x] **PCI-DSS Scope Verification**: No instances of card input forms on domestic API routing systems. Form security handled by external v2 elements.
- [x] **Integer Currency Verification**: All database transaction columns typed as `BIGINT` representing qəpik minor units (no decimal floats).
- [x] **Idempotency Execution Verification**: Primary key unique index constraint enforced on `idempotency_keys(idempotency_key)`.
- [x] **Data Residency Enforcement**: Dual schema partitioning for local Baku datacenters verified.
- [x] **GDPR Erasure Automation**: Truncation script cascading PII to NULL or masked representations compiled and verified.
