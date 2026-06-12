# Handoff Report: Grammatical Copywriter & Azerbaijani Localizer

## 1. Observation
I have performed a thorough grammatical, spelling, and contextual audit of the Azerbaijani (AZ) and English (EN) localizations. I directly observed the following:

1. **Vitest Failure in Backend Translation Tests**:
   * **File**: `apps/api/src/shared/i18n/i18n.test.ts`
   * **Line**: 85
   * **Verbatim Code**: `expect(rows.length).toBe(3 * 5); // 3 locales × 5 keys`
   * **Command executed**: `npx vitest run src/shared/i18n` in `/Users/kamrannamazov/Desktop/linkfit/apps/api`
   * **Verbatim Error**:
     ```bash
     ❯ src/shared/i18n/i18n.test.ts (11 tests | 1 failed) 8ms
       × i18n / renderPushTemplate > ships copy for every (locale, key) pair 5ms
         → expected 24 to be 15 // Object.is equality
     ```

2. **Inconsistent Followers/Following Terminology (iOS)**:
   * **File**: `apps/ios/Linkfit/Resources/Localizable.xcstrings`
   * **Profile strings (Verbatim lines 22264-22292)**:
     ```json
     "profile.followers": {
       "localizations": {
         "az": { "stringUnit": { "state": "translated", "value": "İzləyicilər" } }
       }
     },
     "profile.following": {
       "localizations": {
         "az": { "stringUnit": { "state": "translated", "value": "İzlədikləri" } }
       }
     }
     ```
   * **Invitations list strings (Verbatim lines 13638, 13660, 13704, 13748, 13814)**:
     * `invitations.post_create.empty.title` -> `"Hələ follower yoxdur"`
     * `invitations.post_create.error.load` -> `"Followers yüklənmədi"`
     * `invitations.post_create.heading` -> `"Followers-ə dəvət göndər?"`
     * `invitations.post_create.loading` -> `"Followers yüklənir…"`
     * `invitations.post_create.search.placeholder` -> `"Followers ara…"`

3. **Backend Push Suffix & Hyphenation Issues**:
   * **File**: `apps/api/src/shared/i18n/push.templates.ts`
   * **Verbatim Code (Lines 70-76)**:
     ```typescript
     "squad.invite": {
       title: "Squad dəvəti",
       body: "{inviter} sizi '{squad_name}' squad-a dəvət etdi",
     },
     "squad.accept": {
       title: "Squad-a qoşuldu",
       body: "{user} sizin squadınıza qoşuldu",
     },
     ```

4. **Incomplete Reaction Phrase**:
   * **File**: `apps/api/src/shared/i18n/push.templates.ts`
   * **Verbatim Code (Lines 78-81)**:
     ```typescript
     "story.react": {
       title: "{reactor} reaksiya verdi",
       body: "{emoji_label} story-nizə",
     },
     ```

5. **Mixed Direct Address Pronouns (Tone Discrepancy)**:
   * **File**: `apps/api/src/shared/i18n/push.templates.ts`
   * **Verbatim Code (Lines 84-87, 101-104)**:
     ```typescript
     "story.mention": {
       title: "Story-də qeyd edildin",
       body: "{mentioner} sizi öz story-sində qeyd etdi",
     },
     "digest.daily": {
       title: "Bu gün Linkfit-də",
       body: "{count} yeni xəbər səni gözləyir — {headline} və daha çox",
     },
     ```

6. **Hardcoded Sign-up Push Notification**:
   * **File**: `apps/api/src/modules/referrals/referrals.service.ts`
   * **Verbatim Code (Lines 463-464)**:
     ```typescript
     title: "Yeni dəvətli!",
     body: `${params.newUserDisplayName} sənin kodun ilə qoşuldu.`,
     ```

---

## 2. Logic Chain
1. Since the backend push template catalog in `push.templates.ts` has grown to 8 templates but the Vitest assertion in `i18n.test.ts` was left at `3 * 5` (15 templates), running `npx vitest` naturally crashes (expecting 15 but receiving 24).
2. The profile page uses the correct literary and premium term `"İzləyicilər"` for followers, but the recently written game invitation catalog uses `"Followers"`, creating a highly disjointed user experience and violating standard terminology.
3. Azerbaijani noun adjuncts require third-person possessive suffixes (`squad-ına`) when modified by a team name. Leaving it as `squad-a` is syntactically invalid. Writing `squadınıza` without a hyphen contradicts the rest of the codebase which writes `squad-a`, `squad-dan`, etc.
4. Azerbaijani word order requires verbs to conclude phrases. A direct English copy translation `"{emoji_label} to your story"` becomes the dangling phrase `"{emoji_label} story-nizə"`, which has no verb and sounds broken on iOS notification banners.
5. Mixing formal/plural `"sizi/story-nizə"` and informal/singular `"səni/qeyd edildin"` in the push notifications system degrades the premium brand feeling of the application. Aligning them establishes a consistent, premium startup voice.
6. Hardcoding notification text in service files (such as `referrals.service.ts`) bypasses the `push.templates.ts` localizer structure, preventing translation for English or Russian-speaking users.

---

## 3. Caveats
No caveats. All investigations were fully executed and verified locally.

---

## 4. Conclusion
Linkfit's Azerbaijani copy is generally highly idiomatic, but has suffered from fragmented expansion where new features (e.g. the referral notification and the invitations follower sheet) were implemented with hurried translations (hardcoded text or mixed English loan words).

By implementing the three prepared assets in our agent folder, the team will:
1. **Fix the failing backend Vitest test** instantly.
2. **Unify Followers/Following terminology** under standard Azerbaijani `"İzləyici"` formats.
3. **Correct grammatical suffixes, hyphenations, and sentence structures** in push templates.
4. **Establish a cohesive tone profile** (either Option A: Formal or Option B: Informal).
5. **Decouple the referral push copy** into the template system for complete multi-locale coverage (AZ, EN, RU).

---

## 5. Verification Method
1. **To verify the backend test fix**:
   * Apply the patch `/Users/kamrannamazov/Desktop/linkfit/.agents/grammatical_copywriter_az_localizer/i18n_test_fix.patch` to `apps/api/src/shared/i18n/i18n.test.ts`.
   * Run the test suite command:
     ```bash
     npx vitest run src/shared/i18n
     ```
     in the directory `/Users/kamrannamazov/Desktop/linkfit/apps/api`. It will pass with exit code `0`.
2. **To inspect the proposed push template improvements**:
   * Inspect the replacement file `/Users/kamrannamazov/Desktop/linkfit/.agents/grammatical_copywriter_az_localizer/proposed_push.templates.ts` to see both Option A (Formal) and Option B (Informal) clean, grammatically sound templates.
3. **To verify iOS catalog issues**:
   * Inspect `/Users/kamrannamazov/Desktop/linkfit/apps/ios/Linkfit/Resources/Localizable.xcstrings` around line 13630-13830 to review the mixed "Followers" translations.
