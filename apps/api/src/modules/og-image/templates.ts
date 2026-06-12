/**
 * Satori element trees for the three OG card variants.
 *
 * Satori accepts a React-flavored shape — `{ type, props: { children, style } }`
 * — but does not actually require React. We construct the trees by hand so
 * the API package never needs to install `react` just to render a PNG.
 *
 * The `SatoriElement` type here is intentionally permissive (matching the
 * `ReactNode` shape satori expects internally). All cards share the
 * 1200×630 canvas, dark `#0A0E14` background, and lime (`#C7F465`) accent
 * stripe — the same palette the iOS app uses for its dark theme.
 */

// Satori accepts any React-like element node. Re-declared locally so we
// don't pull `react` into the production dependency closure.
export interface SatoriElement {
  type: string;
  key?: string | number | null;
  props: Record<string, unknown> & { children?: unknown };
}

const COLOR_BG = "#0A0E14";
const COLOR_BG_PANEL = "#121826";
const COLOR_ACCENT = "#C7F465";
const COLOR_TEXT = "#FFFFFF";
const COLOR_MUTED = "#8B95A7";
const COLOR_RING = "#1F2937";

const FONT_FAMILY = "Inter";

function el(
  type: string,
  props: Record<string, unknown>,
  ...children: unknown[]
): SatoriElement {
  const flat = children.flat(Infinity).filter((c) => c !== false && c !== null && c !== undefined);
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
      gap: 12,
    },
    div(
      {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: COLOR_ACCENT,
        alignItems: "center",
        justifyContent: "center",
      },
      span(
        {
          color: COLOR_BG,
          fontSize: 24,
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
      "LinkFit",
    ),
  );
}

function accentStripe(): SatoriElement {
  return div({
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 12,
    backgroundColor: COLOR_ACCENT,
  });
}

function initialsCircle(
  displayName: string,
  size: number,
  isHost: boolean,
): SatoriElement {
  // Two-letter initials — first letters of the first two words, then
  // first two letters as a fallback. ASCII-uppercased.
  const cleaned = displayName.trim();
  const parts = cleaned.split(/\s+/).slice(0, 2);
  const initials =
    parts.length >= 2 && parts[0] !== undefined && parts[1] !== undefined
      ? `${parts[0].charAt(0)}${parts[1].charAt(0)}`
      : cleaned.slice(0, 2);
  const upper = initials.toUpperCase();

  return div(
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: COLOR_BG_PANEL,
      border: `4px solid ${isHost ? COLOR_ACCENT : COLOR_RING}`,
      alignItems: "center",
      justifyContent: "center",
    },
    span(
      {
        fontSize: Math.floor(size * 0.36),
        fontWeight: 700,
        color: isHost ? COLOR_ACCENT : COLOR_TEXT,
      },
      upper,
    ),
  );
}

function emptyAvatarSlot(size: number): SatoriElement {
  return div({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: "rgba(255,255,255,0.04)",
    border: `4px dashed ${COLOR_RING}`,
  });
}

function formatGameDate(iso: string): { date: string; time: string } {
  // We render in a stable UTC-ish format. The OG image is a server-side
  // artifact — we don't have a viewer locale to thread through, so we
  // pick a compact, locale-agnostic shape: "Sat 23 Nov · 19:30".
  const d = new Date(iso);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const wd = weekdays[d.getUTCDay()] ?? "";
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()] ?? "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${wd} ${String(day)} ${month}`,
    time: `${hh}:${mm}`,
  };
}

function formatDateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const sMon = months[s.getUTCMonth()] ?? "";
  const eMon = months[e.getUTCMonth()] ?? "";
  if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) {
    return `${String(s.getUTCDate())}–${String(e.getUTCDate())} ${sMon} ${String(s.getUTCFullYear())}`;
  }
  return `${String(s.getUTCDate())} ${sMon} – ${String(e.getUTCDate())} ${eMon} ${String(e.getUTCFullYear())}`;
}

// ─────────────────────── GAME card ───────────────────────

export interface GameCardData {
  title: string;
  venueName: string | null;
  startsAt: string; // ISO
  capacity: number;
  participantsCount: number;
  skillMinElo: number | null;
  skillMaxElo: number | null;
  participants: { displayName: string; isHost: boolean }[];
}

export function gameCard(data: GameCardData): SatoriElement {
  const { date, time } = formatGameDate(data.startsAt);
  const fillPct = Math.min(
    100,
    Math.round((data.participantsCount / Math.max(1, data.capacity)) * 100),
  );

  const eloLabel =
    data.skillMinElo !== null && data.skillMaxElo !== null
      ? `ELO ${String(data.skillMinElo)}–${String(data.skillMaxElo)}`
      : data.skillMinElo !== null
        ? `ELO ${String(data.skillMinElo)}+`
        : data.skillMaxElo !== null
          ? `ELO ≤ ${String(data.skillMaxElo)}`
          : "All levels";

  const slots = data.participants.slice(0, Math.min(4, data.capacity));
  const emptyCount = Math.max(0, Math.min(4, data.capacity) - slots.length);

  return div(
    {
      width: 1200,
      height: 630,
      backgroundColor: COLOR_BG,
      flexDirection: "column",
      padding: "56px 72px",
      position: "relative",
      fontFamily: FONT_FAMILY,
      color: COLOR_TEXT,
    },
    accentStripe(),

    // Header row.
    div(
      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
      wordmark(),
      span(
        {
          fontSize: 20,
          fontWeight: 600,
          color: COLOR_ACCENT,
          letterSpacing: 2,
          textTransform: "uppercase",
        },
        "Padel · Game",
      ),
    ),

    // Title.
    div(
      { flexDirection: "column", marginTop: 48, gap: 12 },
      span(
        {
          fontSize: 60,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -1.5,
        },
        data.title,
      ),
      span(
        {
          fontSize: 26,
          color: COLOR_MUTED,
          fontWeight: 500,
        },
        data.venueName !== null && data.venueName.length > 0
          ? `at ${data.venueName}`
          : "Open court · location pinned in app",
      ),
    ),

    // Spacer to push the footer block down.
    div({ flex: 1 }),

    // Date + ELO + capacity bar + avatars.
    div(
      {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 32,
      },
      div(
        { flexDirection: "column", gap: 8 },
        span({ fontSize: 18, color: COLOR_MUTED, fontWeight: 500, letterSpacing: 1 }, "WHEN"),
        span({ fontSize: 36, color: COLOR_TEXT, fontWeight: 700 }, date),
        span(
          { fontSize: 56, color: COLOR_ACCENT, fontWeight: 800, letterSpacing: -1 },
          time,
        ),
        span(
          { fontSize: 18, color: COLOR_MUTED, fontWeight: 600, marginTop: 4 },
          eloLabel,
        ),
      ),

      // Capacity column.
      div(
        { flexDirection: "column", gap: 12, width: 360 },
        span(
          { fontSize: 18, color: COLOR_MUTED, fontWeight: 500, letterSpacing: 1 },
          "PLAYERS",
        ),
        span(
          { fontSize: 32, fontWeight: 700 },
          `${String(data.participantsCount)} / ${String(data.capacity)}`,
        ),
        // Bar background.
        div(
          {
            width: 360,
            height: 14,
            borderRadius: 7,
            backgroundColor: COLOR_RING,
            position: "relative",
            overflow: "hidden",
          },
          // Fill.
          div({
            width: Math.round((360 * fillPct) / 100),
            height: 14,
            backgroundColor: COLOR_ACCENT,
          }),
        ),

        // Avatars row.
        div(
          { flexDirection: "row", gap: 14, marginTop: 14 },
          ...slots.map((p) => initialsCircle(p.displayName, 64, p.isHost)),
          ...Array.from({ length: emptyCount }, () => emptyAvatarSlot(64)),
        ),
      ),
    ),
  );
}

// ─────────────────────── USER card ───────────────────────

export interface UserCardData {
  displayName: string;
  elo: number;
  winRate: number; // 0..1
  gamesPlayed: number;
}

export function userCard(data: UserCardData): SatoriElement {
  const winPct = Math.round(data.winRate * 100);
  return div(
    {
      width: 1200,
      height: 630,
      backgroundColor: COLOR_BG,
      flexDirection: "column",
      padding: "56px 72px",
      position: "relative",
      fontFamily: FONT_FAMILY,
      color: COLOR_TEXT,
    },
    accentStripe(),
    div(
      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
      wordmark(),
      span(
        {
          fontSize: 20,
          fontWeight: 600,
          color: COLOR_ACCENT,
          letterSpacing: 2,
          textTransform: "uppercase",
        },
        "Player profile",
      ),
    ),

    div(
      {
        flexDirection: "row",
        marginTop: 64,
        gap: 56,
        alignItems: "center",
      },
      initialsCircle(data.displayName, 240, true),
      div(
        { flexDirection: "column", gap: 8 },
        span(
          {
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1.05,
          },
          data.displayName,
        ),
        span({ fontSize: 24, color: COLOR_MUTED, fontWeight: 500 }, "Padel · LinkFit"),
      ),
    ),

    div({ flex: 1 }),

    // Stats row.
    div(
      { flexDirection: "row", gap: 24 },
      statCard("ELO", String(data.elo), true),
      statCard("Win rate", `${String(winPct)}%`, false),
      statCard("Games played", String(data.gamesPlayed), false),
    ),
  );
}

function statCard(label: string, value: string, emphasize: boolean): SatoriElement {
  return div(
    {
      flex: 1,
      flexDirection: "column",
      gap: 10,
      padding: "24px 28px",
      backgroundColor: COLOR_BG_PANEL,
      borderRadius: 16,
      border: emphasize ? `3px solid ${COLOR_ACCENT}` : `1px solid ${COLOR_RING}`,
    },
    span(
      {
        fontSize: 18,
        color: COLOR_MUTED,
        fontWeight: 500,
        letterSpacing: 1,
        textTransform: "uppercase",
      },
      label,
    ),
    span(
      {
        fontSize: 56,
        fontWeight: 800,
        letterSpacing: -1.5,
        color: emphasize ? COLOR_ACCENT : COLOR_TEXT,
      },
      value,
    ),
  );
}

// ─────────────────────── TOURNAMENT card ───────────────────────

export interface TournamentCardData {
  name: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  prizeMinor: number | null;
  currency: string | null;
  entriesCount: number;
  maxSquads: number;
}

function formatPrize(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || amountMinor <= 0) return "Glory only";
  const major = Math.floor(amountMinor / 100);
  const sym =
    currency === "USD" ? "$"
      : currency === "EUR" ? "€"
        : currency === "AZN" ? "₼"
          : currency !== null ? `${currency} ` : "";
  return `${sym}${major.toLocaleString("en-US")}`;
}

export function tournamentCard(data: TournamentCardData): SatoriElement {
  return div(
    {
      width: 1200,
      height: 630,
      backgroundColor: COLOR_BG,
      flexDirection: "column",
      padding: "56px 72px",
      position: "relative",
      fontFamily: FONT_FAMILY,
      color: COLOR_TEXT,
    },
    accentStripe(),
    div(
      { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
      wordmark(),
      span(
        {
          fontSize: 20,
          fontWeight: 600,
          color: COLOR_ACCENT,
          letterSpacing: 2,
          textTransform: "uppercase",
        },
        "Tournament",
      ),
    ),

    div(
      { flexDirection: "column", marginTop: 56, gap: 14 },
      span(
        {
          fontSize: 68,
          fontWeight: 800,
          letterSpacing: -2,
          lineHeight: 1.05,
        },
        data.name,
      ),
      span({ fontSize: 26, color: COLOR_ACCENT, fontWeight: 600 }, formatDateRange(data.startsAt, data.endsAt)),
    ),

    div({ flex: 1 }),

    div(
      { flexDirection: "row", gap: 24 },
      statCard("Prize", formatPrize(data.prizeMinor, data.currency), true),
      statCard(
        "Squads",
        `${String(data.entriesCount)} / ${String(data.maxSquads)}`,
        false,
      ),
    ),
  );
}
