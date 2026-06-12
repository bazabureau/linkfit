# Grammatical and Localization Quality Report: Azerbaijani & English Alignments
**Author**: Grammatical Copywriter & Azerbaijani Localizer Agent  
**Date**: June 1, 2026  
**Project**: Linkfit (iOS Swift Client & Node API)  

---

## 1. Executive Summary
This report presents a comprehensive grammatical, spelling, and contextual audit of localized copy, push notifications, error messages, and viral marketing templates across the Linkfit iOS Swift Client (`Localizable.xcstrings`) and Node API (`push.templates.ts` and `referrals.service.ts`).

While the general localization coverage is broad, our investigation revealed:
1. **A failing test** in the backend i18n test suite (`i18n.test.ts`) due to outdated expectations.
2. **Severe terminology inconsistencies** between the Profile and Invitations screens (mixing formal Azerbaijani `"İzləyici"` with raw English `"Followers"` loan words).
3. **Grammatical syntax violations** regarding noun adjuncts and possessive suffixes in Azerbaijani push templates.
4. **Incomplete/broken story reaction templates** due to literal word-for-word translation.
5. **Direct address pronoun inconsistencies** (confusing informal `"sən"` and formal `"siz"` addresses).
6. **Hardcoded push copy** in the referrals service preventing non-AZ localization.

---

## 2. Key Findings & Recommended Fixes

### Finding 1: Failing Backend i18n Test (`i18n.test.ts`)
* **Location**: `apps/api/src/shared/i18n/i18n.test.ts:85`
* **Direct Observation**:
  The unit test expects 15 total push templates (3 locales × 5 templates), but the actual catalog has grown to 8 templates in `push.templates.ts`, making it 24 pairs. Running vitest yields:
  ```bash
  AssertionError: expected 24 to be 15 // Object.is equality
  - 15
  + 24
  ```
* **Solution**: Apply the prepared patch `i18n_test_fix.patch` to update the assertion to `3 * 8`.

---

### Finding 2: Lazy English Loan Words vs. Official "İzləyici" Terminology (iOS Client)
* **Location**: `apps/ios/Linkfit/Resources/Localizable.xcstrings`
* **Direct Observation**:
  The profile screen correctly uses Azerbaijani terms:
  * `"profile.followers"` -> `"İzləyicilər"`
  * `"profile.following"` -> `"İzlədikləri"`
  
  However, on the newly developed follower invitation sheet under `invitations.post_create`, the localizations are hasty, inserting `"Followers"` verbatim with raw Azerbaijani grammatical endings:
  
  | Key | Verbatim Translation (AZ) | English Mirror | Impact / Problem | Recommended Fix |
  | :--- | :--- | :--- | :--- | :--- |
  | `invitations.post_create.empty.title` | `"Hələ follower yoxdur"` | `"No followers yet"` | Mixing English root in AZ grammar. | `"Hələ izləyicin yoxdur"` |
  | `invitations.post_create.error.load` | `"Followers yüklənmədi"` | `"Could not load followers"` | Unprofessional UX. | `"İzləyicilər yüklənmədi"` |
  | `invitations.post_create.heading` | `"Followers-ə dəvət göndər?"` | `"Invite your followers?"` | Grammatically mixed hyphenation. | `"İzləyicilərə dəvət göndər?"` |
  | `invitations.post_create.loading` | `"Followers yüklənir…"` | `"Loading followers…"` | Lazily translated. | `"İzləyicilər yüklənir…"` |
  | `invitations.post_create.search.placeholder` | `"Followers ara…"` | `"Search followers…"` | Inconsistent terminology. | `"İzləyici ara…"` or `"İzləyiciləri axtar…"` |

---

### Finding 3: Grammatical Suffix and Hyphenation Errors in Squad Invites & Accepts
* **Location**: `apps/api/src/shared/i18n/push.templates.ts`
* **Direct Observation**:
  * **Squad invite body**: `"{inviter} sizi '{squad_name}' squad-a dəvət etdi"`
    * *Problem*: In Azerbaijani, when `{squad_name}` precedes `squad`, they form a noun adjunct (təyini söz birləşməsi) that **requires** a third-person possessive suffix (`-ı/-i/-u/-ü`) plus the dative case marker (`-na/-nə`). Saying `squad-a` sounds extremely unnatural (comparable to "invited you to Baku Aces the squad" instead of "the squad of Baku Aces").
    * *Fix*: `{inviter} sizi '{squad_name}' squad-ına dəvət etdi`
  * **Squad accept body**: `"{user} sizin squadınıza qoşuldu"`
    * *Problem*: "squadınıza" is written without a hyphen, whereas all other keys use the hyphenated form (`squad-a`, `squad-dan`, `squad-ı`).
    * *Fix*: `{user} sizin squad-ınıza qoşuldu`

---

### Finding 4: Incomplete & Awkward Story Reaction Sentence
* **Location**: `apps/api/src/shared/i18n/push.templates.ts`
* **Direct Observation**:
  * **Reaction body**: `"{emoji_label} story-nizə"` (e.g. `"🔥 story-nizə"`)
    * *Problem*: This was a word-for-word translation of the English structure `"{emoji_label} to your story"`. However, because the Azerbaijani verb comes at the end of the sentence, this notification lacks a verb entirely and reads like a dangling modifier. Combined with the title `"{reactor} reaksiya verdi"`, it sounds disjointed.
    * *Fix*: Standardize it to include the reaction verb for complete syntax.
      * *Formal*: `"Story-nizə {emoji_label} reaksiyası bildirdi"`
      * *Informal*: `"Story-nə {emoji_label} reaksiyası bildirdi"`

---

### Finding 5: Pronoun & Verb Agreement Inconsistencies (Formal vs. Informal Tone)
* **Location**: `apps/api/src/shared/i18n/push.templates.ts`
* **Direct Observation**:
  The push notification templates mix formal address (plural/respectful `"siz"`) and informal address (singular `"sən"`), which ruins the premium brand positioning:
  * `story.mention` title uses **informal** `"qeyd edildin"`, but the body uses **formal** `"sizi"` and `"story-sində"`.
  * `digest.daily` body uses **informal** `"səni gözləyir"`, whereas `squad.invite` and `game.invite` use **formal** `"sizi"`.

To help the development team establish a premium startup tone, we have designed two unified profiles:

#### Option A: Unified Friendly-Formal (Recommended)
This aligns with Linkfit's predominant conversational tone in iOS modals and warning dialogs.
* **squad.invite body**: `{inviter} sizi '{squad_name}' squad-ına dəvət etdi`
* **squad.accept body**: `{user} sizin squad-ınıza qoşuldu`
* **story.react body**: `Story-nizə {emoji_label} reaksiyası bildirdi`
* **story.mention title**: `Story-də qeyd edildiniz`
* **story.mention body**: `{mentioner} sizi öz story-sində qeyd etdi`
* **game.invite body**: `{inviter} sizi '{game_title}' oyununa dəvət etdi`
* **digest.daily body**: `{count} yeni xəbər sizi gözləyir — {headline} və daha çox`

#### Option B: Unified Friendly-Informal (Alternative)
This provides a highly intimate and energetic brand voice, suited for a young sports community.
* **squad.invite body**: `{inviter} səni '{squad_name}' squad-ına dəvət etdi`
* **squad.accept body**: `{user} sənin squad-ına qoşuldu`
* **story.react body**: `Story-nə {emoji_label} reaksiyası bildirdi`
* **story.mention title**: `Story-də qeyd edildin`
* **story.mention body**: `{mentioner} səni öz story-sində qeyd etdi`
* **game.invite body**: `{inviter} səni '{game_title}' oyununa dəvət etdi`
* **digest.daily body**: `{count} yeni xəbər səni gözləyir — {headline} və daha çox`

---

### Finding 6: Hardcoded & Non-Localizable "Yeni dəvətli!" Notification
* **Location**: `apps/api/src/modules/referrals/referrals.service.ts:460-469`
* **Direct Observation**:
  ```typescript
  await this.deps.notifications.emit({
    userId: params.referrerUserId,
    type: "system",
    title: "Yeni dəvətli!",
    body: `${params.newUserDisplayName} sənin kodun ilə qoşuldu.`,
    ...
  });
  ```
  * *Problem*: The referral signup push notification is hardcoded inside the service layer. This prevents localization into English or Russian, rendering the exact same Azerbaijani string for foreign users and breaking the server's i18n structure.
  * *Fix*: Define a new template key `referral.signup` in `push.templates.ts` and resolve the localized string dynamically inside `referrals.service.ts`:
    * **AZ (Formal)**: `"Yeni dəvətli! {newUserDisplayName} sizin kodunuz ilə qoşuldu."`
    * **AZ (Informal)**: `"Yeni dəvətli! {newUserDisplayName} sənin kodun ilə qoşuldu."`
    * **EN**: `"New referral! {newUserDisplayName} joined using your code."`
    * **RU**: `"Новое приглашение! {newUserDisplayName} присоединился(ась) по вашему коду."`

---

## 3. Comparative String Alignment Audit
Below is a comparative alignment table showcasing the semantic equivalent check between Azerbaijani (AZ) and English (EN) string alignments, confirming grammatical precision.

| Push Key | English Copy (EN) | Azerbaijani Original (AZ) | Azerbaijani Polished (AZ Option A) | Semantic Equivalence Check |
| :--- | :--- | :--- | :--- | :--- |
| `feed.comment` | `{actor} commented` | `{actor} şərh yazdı` | *(Unchanged)* | **Perfect**. Verbatim equivalence. |
| `squad.invite` | `{inviter} invited you to '{squad_name}'` | `{inviter} sizi '{squad_name}' squad-a dəvət etdi` | `{inviter} sizi '{squad_name}' squad-ına dəvət etdi` | **Corrected**. Suffix harmony added to reflect noun adjunct. |
| `squad.accept` | `{user} joined your squad` | `{user} sizin squadınıza qoşuldu` | `{user} sizin squad-ınıza qoşuldu` | **Corrected**. Added standard squad hyphenation. |
| `story.react` | `{emoji_label} to your story` | `{emoji_label} story-nizə` | `Story-nizə {emoji_label} reaksiyası bildirdi` | **Polished**. Fixed grammatically incomplete dangling phrase. |
| `story.mention` | `{mentioner} tagged you in their story` | `{mentioner} sizi öz story-sində qeyd etdi` | `{mentioner} sizi öz story-sində qeyd etdi` | **Perfect**. Expresses own (`öz`) and location (`story-sində`) correctly. |
| `game.invite` | `{inviter} invited you to '{game_title}'` | `{inviter} sizi '{game_title}' oyununa dəvət etdi` | *(Unchanged)* | **Perfect**. Completely natural. |
| `digest.weekly` | `Your weekly recap is ready! 📊` | `Həftəlik hesabat hazırdır! 📊` | *(Unchanged)* | **Perfect**. Fully semantic. |
| `digest.daily` | `{count} new updates waiting — {headline} and more` | `{count} yeni xəbər səni gözləyir — {headline} və daha çox` | `{count} yeni xəbər sizi gözləyir — {headline} və daha çox` | **Corrected**. Aligned to formal address for consistency. |

---

## 4. Conclusion & Action Items
1. **Apply i18n Test Fix Patch**: Apply `i18n_test_fix.patch` immediately to restore Vitest stability for `npm run test` or local CI pipelines.
2. **Standardize iOS Catalog Terminology**: Perform find-and-replace in `Localizable.xcstrings` replacing the lazy `"Followers"` occurrences in `invitations.post_create` keys with their appropriate `"İzləyici/İzləyicilər"` equivalents.
3. **Adopt Polished Backend Templates**: Update `push.templates.ts` using the provided `proposed_push.templates.ts` to establish a flawless, grammatically sound, and tone-consistent Azerbaijani catalog.
4. **Refactor Hardcoded Referral Push**: Move the hardcoded `"Yeni dəvətli!"` push copy out of `referrals.service.ts` and integrate it into the `push.templates` ecosystem.
