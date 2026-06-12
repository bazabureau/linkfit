# Linkfit Premium Customer Support & Community Management Guide
**Version**: 1.0.0  
**Target Market**: Baku, Azerbaijan (Premium Padel & Community Sports)  
**Document Classification**: Operational SOP & Onboarding Blueprint  

---

## 🏛 Executive Introduction

Linkfit is the premier community hub for padel and fitness enthusiasts in Baku, powering matching, tournaments, and court bookings for elite venues such as **Sea Breeze Padel Club**, **Baku Padel**, and **Boulevard Padel**. 

To maintain our premium brand experience, this guide establishes the standards for onboarding, venue administration, and customer support. Our goal is to ensure a white-glove, high-satisfaction user journey for both elite athletes and prestige venue owners in Azerbaijan.

---

## 📱 1. Athlete Registration & Onboarding Guide

A flawless mobile onboarding flow is crucial to convert casual padel players into lifetime active community members. This section details the complete user journey from first download to joining their first matched doubles game.

### 1.1 Premium SwiftUI Onboarding Flow
The iOS application provides a highly polished, native SwiftUI interface designed with a luxurious aesthetic, using responsive spring dynamics (`SpringPressStyle.swift` with `0.97` press scale, `0.3` response, and `0.7` damping) to ensure fluid tactile feedback.

```
+-------------------------------------------------------------+
|                     [ Language Selection ]                  |
|               Elegant branding. Select Language:            |
|                  [ AZERBAIJANI ]   [ ENGLISH ]              |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                      [ SMS Verification ]                   |
|           Enter phone: +994 ( [50/51/55/60/70/77/99] ) _____   |
|               [ Send Verification Code (OTP) ]              |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                     [ Player Profile Setup ]                |
|  - Real Name & Username     - Profile Photo Selection       |
|  - Emergency Medical Info   - Invite/Referral Code Entry    |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                     [ ELO Skill Calibration ]               |
|            Complete the 4-question self-assessment          |
|            to determine your starting Linkfit ELO.          |
+-------------------------------------------------------------+
```

1. **Step 1: Language Customization**
   - The athlete is welcomed with a minimalist, high-contrast welcome screen.
   - They choose between **Azerbaijani** (`AppLanguage.AZ`) and **English** (`AppLanguage.EN`). 
   - All subsequent UI displays native, elite terminology (e.g., *"Rezervasiyalar və Təqvim Planı"* instead of *"Rezervasiyalar"*, and soft confirmation prompts like *"Bəli, ləğv edilsin"* instead of harsh machine translations).

2. **Step 2: Secure SMS Verification**
   - Integrates with major Azerbaijani carriers (Azercell, Bakcell, Nar, and Nakhtel). The mobile prefix selectable list supports Azercell (50/51), Bakcell (55/99), Nar (70/77), and Nakhtel (60) carriers seamlessly.
   - One-Time Passcode (OTP) is sent via SMS. The UI features dedicated, auto-focusing numeric input fields.

3. **Step 3: Player Profile Setup**
   - Athletes input their full name, select a unique username, upload a high-resolution profile picture, and provide **Emergency Medical Info** (blood type, allergies) as a safeguard for intense physical play in hot Baku summers.
   - **Referral Code Input**: If the user was referred by a friend, they enter the referral code here. This automatically cues the **5 AZN referral bonus** (500 qəpik) for both the inviter and invitee once the first booking is played, triggering the push notification: *"Yeni dəvətli! Sənin kodun ilə qoşuldu."*

4. **Step 4: ELO Skill Calibration**
   - To prevent matching imbalances, every athlete must complete the ELO Skill Calibration questionnaire (detailed in Section 1.2) to determine their starting tier.

---

### 1.2 ELO Tier Calibration & Skill Assessment

Linkfit relies on a proprietary ELO ratings engine to facilitate balanced matches. Balanced games are essential to player retention. Our calibration process prevents ELO inflation and sandbagging.

#### ELO Rating Tiers in Baku
The Linkfit community classifies players into four distinct, localized rating brackets:

| Azerbaijani Tier Name | English Tier Name | ELO Range | Description & Target Player Profile |
|---|---|---|---|
| **Yeni Başlayan** | Beginner | `500 - 999` | New to racket sports. Learning rules, court geometry, and serving. Struggles with off-the-wall rebounds. |
| **Həvəskar** | Amateur | `1000 - 1499` | Can maintain basic rallies. Understands doubles positioning. Regularly plays friendly games. |
| **Təcrübəli** | Intermediate | `1500 - 1999` | Hits slice/spin, performs structured *bandejas* and *viboras*. Tactically astute, enters amateur leagues. |
| **Peşəkar** | Advanced / Pro | `2000+` | Elite tournament level. Mastery of all defensive and offensive padel techniques. Includes certified club coaches. |

#### Onboarding Skill Assessment Questionnaire
During registration, users answer four questions to calculate their starting calibration score:

1. **Racket Sport History**:  
   *What is your experience level with racket sports (Tennis, Padel, Squash)?*
   - [A] None / Very limited (0 pts)
   - [B] I play recreationally a few times a year (1 pt)
   - [C] I have played competitive tennis or squash at an amateur level (2 pts)
   - [D] I am an active competitive racket athlete or certified coach (3 pts)

2. **The "Bandeja" & Wall Play**:  
   *How comfortable are you with overheads and using the glass walls?*
   - [A] I avoid wall bounces and overhead hits (0 pts)
   - [B] I can hit overheads but struggle to anticipate glass rebounds (1 pt)
   - [C] I actively use the glass walls to defend and can execute a controlled *bandeja* (2 pts)
   - [D] Wall play and tactical overhead variations are core elements of my game (3 pts)

3. **Match Experience & Strategy**:  
   *How often do you play structured padel matches with active scoring?*
   - [A] Never, I only practice hitting or take lessons (0 pts)
   - [B] I play occasional friendly matches without strict competitive rules (1 pt)
   - [C] I play structured doubles matches weekly and understand court positioning (2 pts)
   - [D] I regularly compete in Baku tournaments and leagues (3 pts)

4. **Self-evaluated Physical Pace**:  
   *Describe your physical agility and match endurance:*
   - [A] Moderate pace, prefer casual rallies (0 pts)
   - [B] Active runner, but still mastering physical movement on a padel court (1 pt)
   - [C] High agility, comfortable with fast rallies and intensive defensive recoveries (2 pts)
   - [D] Exceptional conditioning, capable of sustained high-intensity tournament play (3 pts)

#### Initial Calibration Calculation
- **0 - 3 points**: Auto-assigned starting ELO of **650** (*Yeni Başlayan*)
- **4 - 7 points**: Auto-assigned starting ELO of **1150** (*Həvəskar*)
- **8 - 10 points**: Auto-assigned starting ELO of **1650** (*Təcrübəli*)
- **11 - 12 points**: Auto-assigned starting ELO of **2000** (*Peşəkar* - requires validation)

> ⚠️ **Verification Protocol**: To ensure integrity, any user who scores a starting ELO of `2000` or higher must complete their first 3 matches under the supervision of a certified **Match Captain** (a verified user with `ELO > 1800` or a registered venue coach) who confirms the rating level in-app.

---

### 1.3 App Feature Usage Tutorials

Once registered, athletes receive interactive guides explaining how to navigate the Linkfit app:

#### 1. Finding & Creating Matches (`MatchesView.swift`)
- **Smart Matchmaking Queue (M10)**: Athletes can tap *"Maksimal Sürətli Oyun Tap (Smart Match)"* to enter the queue. The backend matches 2 or 4 players within `±150` ELO points and close geographical proximity (using earthdistance coordinates).
- **Match Types**:
  - **Təkli (1v1)**: Singles match requiring 2 players.
  - **Cütlü (2v2)**: Standard doubles match requiring 4 players.
- **Match Host**: The player who creates a match becomes the designated **Kapitan** or **Meydan Sahibi** (Match Host/Captain). They select the court venue, date, time slot, and split preference.

#### 2. Squad Management (`SquadsListView.swift`)
- **Building a Squad**: Players can join or form local squads (e.g. *"Baku Padel Warriors"*, *"Sea Breeze Spinners"*).
- **Captain / Owner Role**: Every squad has a designated Owner (**Squad Kapitanı** or **Komanda Rəhbəri**). The Captain handles tournament roster submissions and coordinates private practice schedules. 
- **Auto-Transfer Safeguard**: If a Captain chooses to leave the squad, the app prompts them to select a new captain. If they exit without selection, ownership automatically transfers to the squad member with the highest active ELO and longest membership duration to prevent orphaned groups.

#### 3. Tournament Registrations (`TournamentDetailView.swift`)
- **Tournament Discovery**: View upcoming Baku amateur and professional padel tournaments.
- **Team Entry Fee Transactions**: Teams can pay registration fees via their integrated **Linkfit Wallet**. Fees are handled in minor units (qəpik) to avoid floating-point math issues on split-payments.

#### 4. Referral Program (`InviteFriendsView.swift`)
- **Earning Balance**: Each user has an invite screen displaying their unique referral code.
- **Dual Payout**: When a friend signs up and plays their first game, both players receive **5.00 AZN** (500 qəpik) directly in their Linkfit Wallet, accompanied by a dynamic push alert.

---

## 🏢 2. B2B Club Management & Venue Administration Guides

Linkfit provides a premium, minimalist B2B dashboard (`dashboard.linkfit.az`) tailored for elite venue administrators. This guide details how managers at venues like **Sea Breeze Padel**, **Baku Padel**, and **Boulevard Gyms** manage their daily operations.

```
   +--------------------------------------------------------+
   |              Linkfit B2B Partner Dashboard             |
   +--------------------------------------------------------+
   |  [Overview]  [Court Settings]  [Discounts]  [Inquiries]|
   +--------------------------------------------------------+
   |                                                        |
   |   Court Inventory:                                     |
   |   - Court 1 (Standard Double) -> Active                |
   |   - Court 2 (Standard Double) -> Active                |
   |   - Court 3 (Single 1v1)     -> Active [Edit Court]    |
   |                                                        |
   |   Pricing Scheme:                                      |
   |   - Off-Peak (07:00 - 17:00): 2,000 qəpik (20 AZN)/hr  |
   |   - Peak (18:00 - 23:00):     3,500 qəpik (35 AZN)/hr  |
   |                                                        |
   |   Active Campaigns:                                    |
   |   - "SEABREEZE20" [20% Off off-peak] [Delete]          |
   |                                                        |
   +--------------------------------------------------------+
```

### 2.1 Club Onboarding Process

To register as a Linkfit Premium Venue Partner, the administrator must submit verification details to ensure payment security and legal compliance in Azerbaijan.

1. **Required Verification Documents**:
   - **VÖEN (Vergi Ödəyicisinin Eyniləşdirmə Nömrəsi)**: Valid tax identification number of the sports venue or holding company.
   - **Bank Details**: Official IBAN (AZ..) and Swift/BIC code of the bank account where weekly court revenue payouts will be transferred.
   - **Physical Location Verification**: Exact GPS coordinates (Latitude/Longitude) of the padel courts, along with a high-resolution photo of the venue.

2. **Dashboard Account Setup**:
   - Once approved by Linkfit Ops, the venue administrator receives a magic login link to access `dashboard.linkfit.az`.
   - The admin assigns dashboard roles (e.g. *Venue Owner*, *Front Desk Manager*, *Court Maintenance Lead*).

---

### 2.2 Court Slot & Pricing Management

Our dashboard uses clean, spaced layouts with slide-out modal drawers for scheduling to avoid crowded grid cells.

#### Adding and Configuring Courts ("Yeni Kort")
- Go to the **Court Settings** tab and tap the **"Yeni Kort"** button.
- Define court specifications:
  - **Court Name**: e.g., *"Sea Breeze Court A (Panoramic Glass)"*.
  - **Court Type**: Select either **Təkli (1v1)** or **Cütlü (2v2)**.
  - **Amenities**: Select from checklists (e.g., Showers, Night Lights, Racket Rental, Towel Service).

#### Configuring Dynamic Pricing (Stored in Qəpik)
To prevent currency rounding errors, all pricing is configured and processed in Azerbaijani qəpik (1 AZN = 100 qəpik).

- **Hourly Rates Strategy**:
  - **Off-Peak (07:00 - 17:00)**: Set at **2,000 qəpik** (20.00 AZN) per hour to attract remote workers and daytime players.
  - **Peak (18:00 - 23:00)**: Set at **3,500 qəpik** (35.00 AZN) per hour during prime-time slots when demand in Baku is highest.
  - **Weekend Prime Rate**: Set at **4,000 qəpik** (40.00 AZN) per hour.

---

### 2.3 Off-Peak Discount Codes & Campaigns (M11 Integrations)

Linkfit’s B2B interface features a Campaign Manager allowing venues to push targeted off-peak discount codes directly to active players located nearby.

#### Step-by-Step Discount Setup
1. In the B2B dashboard, navigate to the **Discounts** tab.
2. Tap **"Yeni Endirim Kampaniyası"** (New Discount Campaign).
3. Fill in the campaign parameters:
   - **Promo Code Name**: e.g., `SEABREEZE20`, `BAKUPADEL15`, `BOULEVARD10`.
   - **Discount Value**: Set the percentage reduction (e.g., `20%`).
   - **Validity Window**: Define the start and end times (e.g., valid only on weekdays from 10:00 to 15:00).
   - **Target Audience Proximity**: Define target player radius (e.g., send push alerts to players within a 10 km radius of the venue).
4. Tap **"Kampaniyanı Başlat"** (Launch Campaign).

#### System Execution
- The Linkfit push notifications worker schedules and triggers a highly localized, premium push alert to target players:
  - **Azerbaijani Push**: *"Klub Endirimi! Sea Breeze Padel Club kortunda 20% endirim! Promo kod: SEABREEZE20"*
  - **Deep-Link Execution**: When a player taps the notification, the application uses deep routing (`linkfit://discounts/{id}`) to open a dedicated booking modal in the app with the discount pre-applied.

---

### 2.4 Client Inquiry & Court Support Dashboard

The B2B dashboard includes an unified inbox for venue admins to handle player inquiries.

- **Booking Adjustments**: If a player needs to reschedule due to extreme weather (e.g. Baku's high winds, *Xəzri*), the venue administrator can access the booking and reschedule the slot in the calendar with a single click.
- **Support Inquiries**: Direct chat channel between players and the front desk (e.g. asking: *"Do you rent Babolat rackets at the counter?"*). Front desk teams are trained to respond in under 5 minutes to maintain Baku's premium standards of hospitality.

---

## 🛠 3. Premium Customer Support Workflows & SOPs

To support our luxury branding, customer support issues must be handled with efficiency and care. This section provides detailed, step-by-step Standard Operating Procedures (SOPs) for the support team.

### 3.1 Live Chat Escalation Paths

Our support model utilizes a tiered resolution pipeline to resolve issues quickly while keeping high-complexity technical inquiries in the hands of senior staff.

```
[ Player / Club Admin Inquiry ]
               │
               ▼
   ┌───────────────────────┐
   │        TIER 1         │ <─── Chatbot / Self-Service
   │  Instant AI Assistant │      (Resolves 70% of common queries)
   └───────────┬───────────┘
               │ (Unresolved / Complex Request)
               ▼
   ┌───────────────────────┐
   │        TIER 2         │ <─── Local Baku Support Operations
   │    Human Live Agent   │      (SLA < 5 mins; handles qəpik refunds,
   └───────────┬───────────┘       captain transfers, dispute mediation)
               │ (Database or API Bug / Fraud Escalation)
               ▼
   ┌───────────────────────┐
   │        TIER 3         │ <─── Core Tech & Engineering Swarm
   │ Senior Ops / Engineer │      (Direct DB access, code fixes,
   └───────────────────────┘       payment gateway API adjustments)
```

#### Tier 1: Instant AI Assistant (Automated Bot)
- **Scope**: Handles password resets, basic app navigation tutorials, locating partner venues, explaining referral program rules, and checking active ELO levels.
- **SLA**: Instantaneous (0 seconds).
- **Escalation Trigger**: If a player inputs terms related to *"dispute"*, *"refund"*, *"incorrect ELO"*, or explicitly types *"operator"*, the session is immediately routed to a Tier 2 agent.

#### Tier 2: Human Live Agent (Baku Operations Office)
- **Scope**: Direct communication in Azerbaijani or English. Handles booking rescheduling, payment dispute investigations, manual calibration match updates, and squad captain transfer mediation.
- **SLA**: Under 5 minutes.
- **Language Mandate**: Pure, premium, polite Azerbaijani (using formal *"siz"*, avoiding harsh colloquialisms or broken machine translations) or professional English.

#### Tier 3: Core Technology & Engineering Swarm
- **Scope**: Database modifications, Kysely type-safety issues, API transaction failures, payment gateway disputes (Adyen/Portmanat integration), and security/fraud issues.
- **SLA**: Under 2 hours.

---

### 3.2 Payment Dispute Resolution (Split-Bookings in Qəpik)

Linkfit allows match players to split court booking costs. In a 2v2 doubles match, a court booking costing **40.00 AZN** splits into four equal transactions of **1,000 qəpik** (10.00 AZN) each. Handling cancellations and disputes for these split transactions requires precise care.

#### Math & Logic of Split Payouts / Refunds
- **Total Court Price**: $P$ (in qəpik)
- **Number of Players splitting**: $N$ ($N \in \{1, 2, 4\}$)
- **Individual Cost**: $C_i = P / N$
  - *Example*: A 30.00 AZN booking split between 4 players. $3000 / 4 = 750$ qəpik per player.
- **Non-divisible Remainders**: In rare cases where the total price in qəpik is not perfectly divisible by the number of players, the primary booking creator (the Match Captain) is charged the remainder.
  - *Example*: 35.00 AZN (3500 qəpik) split between 3 players. $3500 / 3 = 1166.66...$ Player 2 and 3 pay **1166 qəpik**, and the Captain pays **1168 qəpik** to ensure the total is exactly 3500 qəpik.

#### Refund Eligibility Rules
1. **Cancellation > 24 hours prior to match time**: Full 100% refund of transaction value to all players in the booking. Refunds are sent back to the original payment source or credited to the Linkfit Wallet as requested.
2. **Cancellation between 12 - 24 hours prior to match time**: 50% refund returned as Linkfit Wallet credits. The other 50% is forwarded to the venue partner to cover booking vacancy costs.
3. **Cancellation < 12 hours prior to match time / No-Show**: No refund. The entire fee is transferred to the venue partner.

#### Step-by-Step Refund SOP for Support Agents
When a player requests a refund due to a dispute (e.g., match cancelled due to weather or court double-booking):

1. **Verify the Transaction**: Locate the `booking_id` in the admin console. Confirm the transaction amount was successfully captured in qəpik (e.g. `1000 qəpik`).
2. **Assess Responsibility**: 
   - If the venue cancelled the match (e.g. court maintenance or storm at Sea Breeze): Process a **100% refund** to all participating players.
   - If a player disputed the match outcome or reported a no-show: Open the match chat log and review team activity.
3. **Execute the Refund**:
   - Navigate to the payment panel in the customer support console.
   - Enter the exact refund amount in qəpik (e.g., `750` for 7.50 AZN). **Do not use decimal formatting in database entries to prevent rounding errors.**
   - Apply the original payment's unique idempotency key to prevent double-refunding.
4. **Compensation Buffer**: If the cancellation was caused by a Linkfit system error, issue an additional **500 qəpik** (5.00 AZN) wallet credit to all affected players as a gesture of goodwill.
5. **Log the Action**: Document the refund in the support ticket database, noting the customer's username, venue, disputed slot, and refund transaction ID.

---

### 3.3 Squad Captain / Owner Transfer Support

Padel squads in Baku are highly competitive community groups. If a squad's founder or captain goes inactive, it can stall tournament registrations and team activity.

#### Auto-Transfer Logic on Voluntary Exit
If a squad owner chooses to leave the squad using the in-app interface, the app triggers the following workflow:

```
[ Squad Owner clicks "Qrupu Tərk Et" (Leave Squad) ]
                        │
                        ▼
       Did they nominate a successor Captain?
            ├───> YES: Set nominee as Owner. Exit complete.
            └───> NO: Run Auto-Election Engine:
                       │
                       ▼
             1. Select all squad members.
             2. Filter for active users (active in last 14 days).
             3. Sort by:
                a) Member Join Date (Seniority)
                b) Active ELO Rating (Performance)
             4. Auto-assign ownership to top candidate.
             5. Dispatch push notification to squad:
                "Yeni Kapitan! {New_Owner} qrupun yeni rəhbəridir."
```

#### Manual Support Override SOP (Involuntary / Inactive Captains)
When squad members petition Linkfit Support to transfer ownership because their current Captain has gone offline without leaving the group, support agents must follow these verification protocols:

1. **Verify Inactivity**:
   - Check the Captain's last login date. Inactivity is defined as **no app logins and no match activity for 30 consecutive days**.
   - If the Captain has been active within 30 days, deny the manual transfer. Instruct the petitioners to ask the Captain to transfer ownership directly via the app.

2. **Validate the Petition**:
   - Ensure the request is backed by at least **50% of the active squad members** (or a minimum of 3 members for smaller squads).
   - Verify the legitimacy of the petition by checking squad chat logs or active matching history.

3. **Select the New Captain**:
   - Identify the most suitable successor using the election parameters: oldest active member with a verified high ELO.
   - Verify the nominee has completed their registration profile and has no active safety or behavioral flags.

4. **Execute the Database Transfer**:
   - Submit a Tier 3 database update request to update the `squads` owner reference:
     ```sql
     UPDATE squads 
     SET owner_id = new_captain_user_id, updated_at = NOW() 
     WHERE id = target_squad_id;
     ```
   - Log the ticket under "Manual Squad Owner Transfer" with the reasoning and approvals.

5. **Notify the Community**:
   - Send an automated system message in the squad chat room: 
     - *Azerbaijani*: `"Sistem Mesajı: Komanda üzvlərinin müraciəti əsasında qrupun kapitanı {New_Owner} olaraq təyin edildi. Uğurlar!"`
     - *English*: `"System Message: Based on community request, squad ownership has been transferred to {New_Owner}. Best of luck!"`

---

## 🏆 4. Customer Support Performance Metrics & KPIs

To maintain our premium brand positioning in Azerbaijan, the Linkfit support team is audited against these key performance indicators:

- **First Response Time (FRT)**: 
  - Chat Support: **< 1 minute** (Tier 1 AI), **< 5 minutes** (Tier 2 Human).
  - Email/Ticket Support: **< 2 hours**.
- **Customer Satisfaction Score (CSAT)**: **> 96%** positive feedback rating after ticket resolution.
- **Resolution Rate (FCR)**: **> 85%** of inquiries resolved during the initial contact.
- **ELO Calibration Integrity**: **0%** ELO calibration disputes escalated to complaints. All manual adjustments must carry supervisor signatures.
- **Qəpik Payout Discrepancies**: **0.00 AZN** tolerance for rounding or transfer errors.

This comprehensive guide ensures that every Linkfit representative, venue partner, and athlete in Baku experiences a seamless and professional service ecosystem.
