/**
 * PROPOSED REPLACEMENT for apps/api/src/shared/i18n/push.templates.ts
 *
 * This file presents two grammatically corrected and tone-consistent
 * options for the Azerbaijani localization catalog (AZ).
 *
 * Key grammatical improvements made:
 * 1. Resolved the noun adjunct possessive rule for "{squad_name} squad-a".
 *    In AZ, it must be "{squad_name} squad-ına" (third-person possessive).
 * 2. Standardized squad hyphenation: "squad-ınıza" or "squad-ına" instead
 *    of "squadınıza" to match the rest of the application.
 * 3. Resolved the grammatically incomplete "story-nizə" reaction template.
 *    Converted "{emoji_label} story-nizə" (which lacked a verb) to a complete
 *    and premium phrasing: "Story-nizə {emoji_label} reaksiyası bildirdi".
 * 4. Fixed the pronoun-verb disagreement in "story.mention":
 *    - Title: "Story-də qeyd edildin" (sən) -> "Story-də qeyd edildiniz" (siz)
 *    - Body: "sizi ... qeyd etdi" (siz) -> Aligned completely.
 *
 * Pick either the Friendly-Formal (recommended for conversational messages)
 * or the Friendly-Informal (highly active) catalog below.
 */

import {
  type SupportedLocale,
  interpolate,
  normalizeLocale,
} from "./locale.js";

export type PushTemplateKey =
  | "feed.comment"
  | "squad.invite"
  | "squad.accept"
  | "story.react"
  | "story.mention"
  | "game.invite"
  | "digest.weekly_recap"
  | "digest.daily";

interface Template {
  title: string;
  body: string;
}

type Catalog = Readonly<Record<PushTemplateKey, Template>>;

// ============================================================================
// OPTION A: Friendly-Formal ("Siz" - Recommended for conversational copy)
// ============================================================================
const AZ_FORMAL: Catalog = {
  "feed.comment": {
    title: "{actor} şərh yazdı",
    body: "{snippet}",
  },
  "squad.invite": {
    title: "Squad dəvəti",
    body: "{inviter} sizi '{squad_name}' squad-ına dəvət etdi",
  },
  "squad.accept": {
    title: "Squad-a qoşuldu",
    body: "{user} sizin squad-ınıza qoşuldu",
  },
  "story.react": {
    title: "{reactor} reaksiya verdi",
    body: "Story-nizə {emoji_label} reaksiyası bildirdi",
  },
  "story.mention": {
    title: "Story-də qeyd edildiniz",
    body: "{mentioner} sizi öz story-sində qeyd etdi",
  },
  "game.invite": {
    title: "Oyuna dəvət",
    body: "{inviter} sizi '{game_title}' oyununa dəvət etdi",
  },
  "digest.weekly_recap": {
    title: "Bu həftə padel",
    body: "Həftəlik hesabat hazırdır! 📊",
  },
  "digest.daily": {
    title: "Bu gün Linkfit-də",
    body: "{count} yeni xəbər sizi gözləyir — {headline} və daha çox",
  },
};

// ============================================================================
// OPTION B: Friendly-Informal ("Sən" - High brand-intimacy alternative)
// ============================================================================
const AZ_INFORMAL: Catalog = {
  "feed.comment": {
    title: "{actor} şərh yazdı",
    body: "{snippet}",
  },
  "squad.invite": {
    title: "Squad dəvəti",
    body: "{inviter} səni '{squad_name}' squad-ına dəvət etdi",
  },
  "squad.accept": {
    title: "Squad-a qoşuldu",
    body: "{user} sənin squad-ına qoşuldu",
  },
  "story.react": {
    title: "{reactor} reaksiya verdi",
    body: "Story-nə {emoji_label} reaksiyası bildirdi",
  },
  "story.mention": {
    title: "Story-də qeyd edildin",
    body: "{mentioner} səni öz story-sində qeyd etdi",
  },
  "game.invite": {
    title: "Oyuna dəvət",
    body: "{inviter} səni '{game_title}' oyununa dəvət etdi",
  },
  "digest.weekly_recap": {
    title: "Bu həftə padel",
    body: "Həftəlik hesabat hazırdır! 📊",
  },
  "digest.daily": {
    title: "Bu gün Linkfit-də",
    body: "{count} yeni xəbər səni gözləyir — {headline} və daha çox",
  },
};

// Default to AZ_FORMAL for consistency with iOS modal tone
const AZ = AZ_FORMAL;

const EN: Catalog = {
  "feed.comment": {
    title: "{actor} commented",
    body: "{snippet}",
  },
  "squad.invite": {
    title: "Squad invite",
    body: "{inviter} invited you to '{squad_name}'",
  },
  "squad.accept": {
    title: "Joined your squad",
    body: "{user} joined your squad",
  },
  "story.react": {
    title: "{reactor} reacted",
    body: "{emoji_label} to your story",
  },
  "story.mention": {
    title: "Tagged in a story",
    body: "{mentioner} tagged you in their story",
  },
  "game.invite": {
    title: "Game invite",
    body: "{inviter} invited you to '{game_title}'",
  },
  "digest.weekly_recap": {
    title: "Your padel week",
    body: "Your weekly recap is ready! 📊",
  },
  "digest.daily": {
    title: "Today on Linkfit",
    body: "{count} new updates waiting — {headline} and more",
  },
};

const RU: Catalog = {
  "feed.comment": {
    title: "{actor} прокомментировал(а)",
    body: "{snippet}",
  },
  "squad.invite": {
    title: "Приглашение в команду",
    body: "{inviter} приглашает вас в команду '{squad_name}'",
  },
  "squad.accept": {
    title: "Новый участник команды",
    body: "{user} присоединился(ась) к вашей команде",
  },
  "story.react": {
    title: "{reactor} отреагировал(а)",
    body: "{emoji_label} на вашу историю",
  },
  "story.mention": {
    title: "Отмечен в истории",
    body: "{mentioner} отметил вас в истории",
  },
  "game.invite": {
    title: "Приглашение в игру",
    body: "{inviter} приглашает вас в игру '{game_title}'",
  },
  "digest.weekly_recap": {
    title: "Ваша падел-неделя",
    body: "Еженедельный отчёт готов! 📊",
  },
  "digest.daily": {
    title: "Сегодня в Linkfit",
    body: "{count} новых событий ждут — {headline} и другое",
  },
};

const CATALOGS: Readonly<Record<SupportedLocale, Catalog>> = {
  az: AZ,
  en: EN,
  ru: RU,
};

export function renderPushTemplate(
  key: PushTemplateKey,
  locale: string | null | undefined,
  values: Readonly<Record<string, string | number | boolean | null | undefined>>,
): { title: string; body: string } {
  const normalized = normalizeLocale(locale);
  const catalog = CATALOGS[normalized];
  const tpl = catalog[key];
  return {
    title: interpolate(tpl.title, values),
    body: interpolate(tpl.body, values),
  };
}

export function listPushTemplates(): readonly {
  locale: SupportedLocale;
  key: PushTemplateKey;
  title: string;
  body: string;
}[] {
  const out: {
    locale: SupportedLocale;
    key: PushTemplateKey;
    title: string;
    body: string;
  }[] = [];
  for (const locale of ["az", "en", "ru"] as const) {
    const catalog = CATALOGS[locale];
    for (const key of Object.keys(catalog) as PushTemplateKey[]) {
      const tpl = catalog[key];
      out.push({ locale, key, title: tpl.title, body: tpl.body });
    }
  }
  return out;
}
