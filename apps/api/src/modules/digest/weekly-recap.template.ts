/**
 * Satori element tree for the Wave-10 "Bu həftə padel" weekly recap card.
 *
 * Wrapped(Spotify-style) one-page summary of a user's last 7 days of
 * padel activity. Renders to a square (1080×1080) PNG so the iOS stories
 * rail can display it without letterboxing — stories are always
 * portrait-or-square on the rail; existing OG cards are 1200×630
 * landscape, which would crop awkwardly inside the story viewer.
 *
 * The tree is constructed by hand (no JSX) to match the convention the
 * og-image templates established — the API package never pulls in React
 * just to compose a card. We reuse the same dark + lime palette so the
 * recap visually pairs with the rest of the Linkfit brand surface.
 *
 * AZ-first copy. The card is server-rendered once per user; we don't
 * thread a locale through here because the iOS stories rail mixes
 * locales (a Russian-speaking user can still see another user's
 * AZ-captioned story). The label set lives in AZ to match the primary
 * market. If a per-user-locale recap surface is ever added, swap the
 * `Labels` constant for a locale-aware lookup.
 */

import { type SatoriElement } from "../og-image/templates.js";

const COLOR_BG = "#0A0E14";
const COLOR_BG_PANEL = "#121826";
const COLOR_ACCENT = "#C7F465";
const COLOR_TEXT = "#FFFFFF";
const COLOR_MUTED = "#8B95A7";
const COLOR_RING = "#1F2937";

const FONT_FAMILY = "Inter";

const CANVAS = 1080;

/**
 * AZ copy strings baked into the card. Centralised so the snapshot
 * tests can assert on the rendered character set without each test
 * re-declaring the strings.
 */
export const Labels = {
  brand: "LINKFIT",
  headline: "Bu həftə padel",
  weekShort: "Həftəlik hesabat",
  gamesPlayed: "oyun",
  gamesWon: "qələbə",
  newFollowers: "yeni dost",
  winRate: "qələbə nisbəti",
  newLevel: "Yeni səviyyə",
  partnerOfWeek: "Həftənin tərəfdaşı",
} as const;

/**
 * ELO bands → Azerbaijani level labels. Source mirrors the iOS
 * `SkillLevel` ladder so a server-rendered "Yeni səviyyə: Təcrübəli"
 * line matches what the user sees in the player profile.
 */
export function eloToLevelLabel(elo: number): string {
  if (elo >= 1800) return "Usta";
  if (elo >= 1500) return "Təcrübəli";
  if (elo >= 1300) return "İnkişafda";
  if (elo >= 1100) return "Başlanğıc";
  return "Yeni oyunçu";
}

export interface WeeklyRecapData {
  displayName: string;
  /** Total confirmed games the user played in the trailing 7 days. */
  gamesPlayed: number;
  /** Subset of `gamesPlayed` where the user's team won (from `match_scores`). */
  gamesWon: number;
  /** Number of follow edges where `followed_user_id = user` AND
   *  `created_at >= now() - 7d`. Mirrors the digest agent's
   *  `newFollowersFor` repo method. */
  newFollowers: number;
  /** Most-frequent co-participant across the week — `null` when the
   *  user has < 2 games or no clear partner. */
  mostPlayedWith: {
    displayName: string;
    gamesTogether: number;
  } | null;
  /** Set when the user's ELO band shifted vs. the start of the week.
   *  Drives the "Yeni səviyyə: …" badge. `null` when there's no change
   *  (the dominant case — bands shift slowly). */
  newLevelLabel: string | null;
}

// ─────────────────────── helpers ────────────────────────────

function el(
  type: string,
  props: Record<string, unknown>,
  ...children: unknown[]
): SatoriElement {
  const flat = children
    .flat(Infinity)
    .filter((c) => c !== false && c !== null && c !== undefined);
  return {
    type,
    props: {
      ...props,
      children:
        flat.length === 0
          ? undefined
          : flat.length === 1
            ? flat[0]
            : flat,
    },
  };
}

function div(style: Record<string, unknown>, ...children: unknown[]): SatoriElement {
  return el("div", { style: { display: "flex", ...style } }, ...children);
}

function span(
  style: Record<string, unknown>,
  text: string,
): SatoriElement {
  return el(
    "span",
    {
      style: {
        display: "flex",
        fontFamily: FONT_FAMILY,
        color: COLOR_TEXT,
        ...style,
      },
    },
    text,
  );
}

function wordmark(): SatoriElement {
  return div(
    {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    div(
      {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: COLOR_ACCENT,
        alignItems: "center",
        justifyContent: "center",
      },
      span(
        {
          color: COLOR_BG,
          fontSize: 28,
          fontWeight: 800,
          lineHeight: 1,
        },
        "L",
      ),
    ),
    span(
      {
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: -1,
      },
      Labels.brand,
    ),
  );
}

function initialsCircle(displayName: string, size: number): SatoriElement {
  const cleaned = displayName.trim();
  const parts = cleaned.split(/\s+/).slice(0, 2);
  const initials =
    parts.length >= 2 && parts[0] !== undefined && parts[1] !== undefined
      ? `${parts[0].charAt(0)}${parts[1].charAt(0)}`
      : cleaned.slice(0, 2);
  return div(
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: COLOR_BG_PANEL,
      border: `4px solid ${COLOR_ACCENT}`,
      alignItems: "center",
      justifyContent: "center",
    },
    span(
      {
        fontSize: Math.floor(size * 0.36),
        fontWeight: 700,
        color: COLOR_ACCENT,
      },
      initials.toUpperCase(),
    ),
  );
}

function statCell(
  value: string,
  label: string,
  emphasize: boolean,
): SatoriElement {
  return div(
    {
      flex: 1,
      flexDirection: "column",
      gap: 8,
      padding: "28px 24px",
      backgroundColor: COLOR_BG_PANEL,
      borderRadius: 20,
      border: emphasize ? `3px solid ${COLOR_ACCENT}` : `1px solid ${COLOR_RING}`,
      alignItems: "flex-start",
      justifyContent: "center",
      minHeight: 160,
    },
    span(
      {
        fontSize: 64,
        fontWeight: 800,
        letterSpacing: -2,
        color: emphasize ? COLOR_ACCENT : COLOR_TEXT,
        lineHeight: 1,
      },
      value,
    ),
    span(
      {
        fontSize: 22,
        color: COLOR_MUTED,
        fontWeight: 500,
        letterSpacing: 0.5,
      },
      label,
    ),
  );
}

// ─────────────────────── card ────────────────────────────

/**
 * Build the Satori element tree for the weekly recap card. The render
 * pipeline (`og-image/render.ts::renderToPng`) accepts any
 * `SatoriElement` and the canvas size we want is the same as it does
 * for the other cards — but the recap is square, so the caller passes
 * `{ width: 1080, height: 1080 }` rather than the default 1200×630.
 *
 * Composition (top → bottom):
 *   1. Wordmark + week label header.
 *   2. Headline "Bu həftə padel" + display name.
 *   3. 2×2 grid of stat cells (games, wins, followers, win-rate).
 *   4. Optional "Yeni səviyyə" badge (only when `newLevelLabel`).
 *   5. Footer row with the partner-of-the-week avatar + name (only
 *      when `mostPlayedWith` is non-null).
 */
export function weeklyRecapCard(data: WeeklyRecapData): SatoriElement {
  const winPct =
    data.gamesPlayed === 0
      ? 0
      : Math.round((data.gamesWon / data.gamesPlayed) * 100);

  return div(
    {
      width: CANVAS,
      height: CANVAS,
      backgroundColor: COLOR_BG,
      flexDirection: "column",
      padding: "64px 64px",
      fontFamily: FONT_FAMILY,
      color: COLOR_TEXT,
      gap: 32,
    },

    // Header.
    div(
      {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      },
      wordmark(),
      span(
        {
          fontSize: 22,
          fontWeight: 600,
          color: COLOR_ACCENT,
          letterSpacing: 3,
          textTransform: "uppercase",
        },
        Labels.weekShort,
      ),
    ),

    // Headline + name.
    div(
      { flexDirection: "column", gap: 16 },
      span(
        {
          fontSize: 84,
          fontWeight: 800,
          letterSpacing: -3,
          lineHeight: 1,
        },
        Labels.headline,
      ),
      span(
        {
          fontSize: 32,
          color: COLOR_MUTED,
          fontWeight: 600,
        },
        data.displayName,
      ),
    ),

    // 2×2 stat grid.
    div(
      { flexDirection: "column", gap: 20 },
      div(
        { flexDirection: "row", gap: 20 },
        statCell(String(data.gamesPlayed), Labels.gamesPlayed, true),
        statCell(String(data.gamesWon), Labels.gamesWon, false),
      ),
      div(
        { flexDirection: "row", gap: 20 },
        statCell(String(data.newFollowers), Labels.newFollowers, false),
        statCell(`${String(winPct)}%`, Labels.winRate, false),
      ),
    ),

    // Spacer pushes optional badge + footer down.
    div({ flex: 1 }),

    // Optional level-up badge.
    data.newLevelLabel === null
      ? null
      : div(
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            padding: "20px 28px",
            backgroundColor: COLOR_ACCENT,
            borderRadius: 20,
            alignSelf: "flex-start",
          },
          span(
            {
              fontSize: 22,
              color: COLOR_BG,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            },
            Labels.newLevel,
          ),
          span(
            {
              fontSize: 32,
              color: COLOR_BG,
              fontWeight: 800,
              letterSpacing: -0.5,
            },
            data.newLevelLabel,
          ),
        ),

    // Footer: partner-of-the-week.
    data.mostPlayedWith === null
      ? null
      : div(
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 20,
            padding: "20px 24px",
            backgroundColor: COLOR_BG_PANEL,
            borderRadius: 20,
            border: `1px solid ${COLOR_RING}`,
          },
          initialsCircle(data.mostPlayedWith.displayName, 80),
          div(
            { flexDirection: "column", gap: 4 },
            span(
              {
                fontSize: 18,
                color: COLOR_MUTED,
                fontWeight: 500,
                letterSpacing: 1,
                textTransform: "uppercase",
              },
              Labels.partnerOfWeek,
            ),
            span(
              {
                fontSize: 32,
                fontWeight: 700,
                color: COLOR_TEXT,
                letterSpacing: -0.5,
              },
              data.mostPlayedWith.displayName,
            ),
          ),
        ),
  );
}

/** Square canvas size — exported for `renderToPng` width/height. */
export const RECAP_CANVAS_PX = CANVAS;
