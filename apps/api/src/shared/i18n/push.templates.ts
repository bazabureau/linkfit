/**
 * Push notification copy, per locale, per push type.
 *
 * Why this lives in `shared/` rather than in `modules/push/`:
 *   - Other services (feed-comments, social/squads, stories, invitations) are
 *     the ones that decide *what* to emit. They call into
 *     `NotificationsService.emit({ title, body, ... })` with already-rendered
 *     copy, then `PushService.deliverToUser` is just a transport. Templates
 *     belong with the callers' shared layer, not with the transport.
 *   - Keeping templates in one place makes the audit "do we have AZ/EN/RU for
 *     every push type?" a single-file grep instead of a cross-module hunt.
 *
 * Each entry is a tuple of `{ title, body }` templates with `{placeholder}`
 * tokens that the caller substitutes via `renderPushTemplate`. Placeholders
 * are documented per-key below; missing tokens at render time collapse to
 * empty strings (see `interpolate`), so an unknown actor name produces a
 * slightly awkward banner but never a broken `{actor}` literal in the wild.
 */
import {
  type SupportedLocale,
  interpolate,
  normalizeLocale,
} from "./locale.js";

/**
 * The set of push types this module ships copy for. Distinct from the broader
 * `NotificationType` DB enum because in-DB rows can be emitted by services
 * that build their own copy (e.g. game reminders are formatted with a
 * countdown rendered at emit-time, not from a static template).
 *
 * Wave-9 additions (`feed.comment`, `squad.invite`, `squad.accept`,
 * `story.react`) join the existing `game.invite` template, which previously
 * lived inline in the invitations service.
 */
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
  /** Notification banner title — short, ideally < 30 chars. */
  title: string;
  /** Notification body — APNs truncates at ~240 chars; keep concise. */
  body: string;
}

type Catalog = Readonly<Record<PushTemplateKey, Template>>;

/**
 * AZ — Azerbaijani. This is the source locale and the fallback when the
 * caller's locale is unsupported, since Linkfit's primary audience is AZ.
 *
 * Placeholders documented per-template:
 *  - feed.comment: {actor} = display name; {snippet} = short comment preview
 *  - squad.invite: {inviter} = display name; {squad_name} = team name
 *  - squad.accept: {user} = display name of joiner
 *  - story.react:  {reactor} = display name; {emoji_label} = AZ word for emoji
 *  - game.invite:  {inviter} = display name; {game_title} = booking name
 */
const AZ: Catalog = {
  "feed.comment": {
    title: "{actor} şərh yazdı",
    body: "{snippet}",
  },
  "squad.invite": {
    title: "Squad dəvəti",
    body: "{inviter} sizi '{squad_name}' squad-a dəvət etdi",
  },
  "squad.accept": {
    title: "Squad-a qoşuldu",
    body: "{user} sizin squadınıza qoşuldu",
  },
  "story.react": {
    title: "{reactor} reaksiya verdi",
    body: "{emoji_label} story-nizə",
  },
  // Wave-12: emitted when someone tags this user in a story overlay.
  //   {mentioner} = display name of the story author
  "story.mention": {
    title: "Story-də qeyd edildin",
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
  // Wave-10 daily digest — fired at the user's local 18:00 with a count
  // of fresh highlights since the last digest plus the top headline.
  //   {count}    = integer count of items in the digest (top-3 mix)
  //   {headline} = the top item's short label (player name, game title,
  //                or friend's name + action verb)
  "digest.daily": {
    title: "Bu gün Linkfit-də",
    body: "{count} yeni xəbər səni gözləyir — {headline} və daha çox",
  },
};

/** EN — English mirror of AZ. */
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

/** RU — Russian mirror of AZ. */
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

/**
 * Render a push template for a given user locale.
 *
 * Returns `{ title, body }` ready to feed into
 * `NotificationsService.emit` / `PushService.deliverToUser`. Unsupported
 * locales fall back to `az` via `normalizeLocale` — the call site can pass
 * the raw `users.locale` value without guarding against bad data.
 *
 * The `values` map provides placeholder substitutions. Keys not referenced
 * by the template are ignored; missing keys collapse to empty strings.
 */
export function renderPushTemplate(
  key: PushTemplateKey,
  locale: string | null | undefined,
  values: Readonly<Record<string, string | number | boolean | null | undefined>>,
): { title: string; body: string } {
  const normalized = normalizeLocale(locale);
  // `noUncheckedIndexedAccess` would otherwise force a runtime check here;
  // we model CATALOGS as a complete Record so the lookup is total — but a
  // defensive fallback to the AZ catalog keeps us safe if the type widens.
  const catalog = CATALOGS[normalized];
  const tpl = catalog[key];
  return {
    title: interpolate(tpl.title, values),
    body: interpolate(tpl.body, values),
  };
}

/**
 * Test helper / introspection: list every locale/key combination this
 * module ships copy for. Used by the i18n coverage test to assert that
 * future additions to `PushTemplateKey` come with copy in all three
 * locales — TypeScript catches the missing-locale case for us, but a
 * runtime list is handy for snapshot diffs in code review.
 */
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
