import {
  type BadgeUnlocked,
  type FriendActivity,
  type NewFollower,
  type UpcomingGame,
} from "./digest.repository.js";

/**
 * Plain-text/HTML renderer for the weekly digest.
 *
 * The HTML follows the Linkfit brand:
 *   - dark charcoal header band (#101418)
 *   - lime accent (#c1ff72) on the wordmark + section dividers
 *   - off-black body text on white card
 *   - all CSS inlined — most clients still strip <style> blocks
 *
 * Sections are rendered only when they have content. An "empty" digest is
 * suppressed upstream by the service — so any HTML this function produces
 * has at least one non-empty section.
 */

export interface WeeklyDigestData {
  display_name: string;
  upcoming_games: UpcomingGame[];
  new_followers: NewFollower[];
  friend_activity: FriendActivity[];
  badges_unlocked: BadgeUnlocked[];
}

export interface RenderedDigest {
  subject: string;
  text: string;
  html: string;
}

/**
 * Tiny HTML escaper. We accept untrusted strings from the DB (display_name,
 * achievement name, venue name) and inject them into HTML attributes /
 * content — escaping is non-negotiable. We never insert user-supplied HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_LABEL = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function fmtWhen(d: Date): string {
  // UTC formatting — the iOS client converts to local time. Email clients
  // don't dynamically localize so we surface a fixed UTC label.
  const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return (
    `${DOW_LABEL[d.getUTCDay()] ?? "—"} ${MONTH_LABEL[d.getUTCMonth()] ?? "—"} ` +
    `${pad(d.getUTCDate())} • ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

function activityLabel(type: string): string {
  switch (type) {
    case "joined_game":          return "joined a game";
    case "won_match":            return "won a match";
    case "registered_tournament":return "registered for a tournament";
    case "elo_milestone":        return "hit an ELO milestone";
    case "followed_user":        return "followed someone new";
    case "new_partnership":      return "formed a new partnership";
    default:                     return type;
  }
}

export function hasAnyContent(data: WeeklyDigestData): boolean {
  return (
    data.upcoming_games.length > 0 ||
    data.new_followers.length > 0 ||
    data.friend_activity.length > 0 ||
    data.badges_unlocked.length > 0
  );
}

export function renderWeeklyDigest(data: WeeklyDigestData): RenderedDigest {
  const subject = `Your Linkfit week — ${String(data.upcoming_games.length)} upcoming ${
    data.upcoming_games.length === 1 ? "game" : "games"
  }`;

  // ── Plain-text body ────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`Hi ${data.display_name},`);
  lines.push("");
  lines.push("Here's your Linkfit week.");
  lines.push("");

  if (data.upcoming_games.length > 0) {
    lines.push("YOUR UPCOMING GAMES");
    lines.push("-------------------");
    for (const g of data.upcoming_games) {
      const venue = g.venue_name ?? "Court TBD";
      lines.push(`  • ${fmtWhen(g.starts_at)} — ${g.sport_slug} at ${venue}`);
    }
    lines.push("");
  }

  if (data.new_followers.length > 0) {
    lines.push("PLAYERS WHO FOLLOWED YOU");
    lines.push("------------------------");
    for (const f of data.new_followers) {
      lines.push(`  • ${f.display_name}`);
    }
    lines.push("");
  }

  if (data.friend_activity.length > 0) {
    lines.push("FRIEND ACTIVITY");
    lines.push("---------------");
    for (const a of data.friend_activity) {
      lines.push(`  • ${a.actor_display_name} ${activityLabel(a.type)}`);
    }
    lines.push("");
  }

  if (data.badges_unlocked.length > 0) {
    lines.push("BADGES UNLOCKED");
    lines.push("---------------");
    for (const b of data.badges_unlocked) {
      lines.push(`  • ${b.name}`);
    }
    lines.push("");
  }

  lines.push("See you on court.");
  lines.push("— The Linkfit team");

  const text = lines.join("\n");

  // ── HTML body — every style attribute inlined for client compatibility ──
  const html = renderHtml(data);

  return { subject, text, html };
}

function renderHtml(data: WeeklyDigestData): string {
  const headerStyle =
    "background:#101418;padding:32px 24px;text-align:left;";
  const wordmarkStyle =
    "color:#c1ff72;font:700 24px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:-0.02em;margin:0;";
  const subheadStyle =
    "color:#9ca3af;font:400 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:8px 0 0 0;";
  const bodyStyle =
    "padding:24px;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#101418;";
  const sectionStyle = "margin:0 0 24px 0;";
  const sectionTitleStyle =
    "border-bottom:2px solid #c1ff72;padding-bottom:6px;font:600 14px/1.4 -apple-system,sans-serif;color:#101418;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px 0;";
  const liStyle = "padding:6px 0;border-bottom:1px solid #f1f3f5;color:#1f2937;";
  const muteStyle = "color:#6b7280;font-size:13px;";
  const footerStyle =
    "padding:16px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font:400 12px/1.5 -apple-system,sans-serif;text-align:center;";

  const parts: string[] = [];
  parts.push("<!doctype html>");
  parts.push(
    `<html><body style="margin:0;background:#f7f8fa;">`,
  );
  parts.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;">`,
  );

  // Header
  parts.push(`<tr><td style="${headerStyle}">`);
  parts.push(`<p style="${wordmarkStyle}">LINKFIT</p>`);
  parts.push(
    `<p style="${subheadStyle}">Your weekly digest, ${escapeHtml(data.display_name)}.</p>`,
  );
  parts.push(`</td></tr>`);

  // Body
  parts.push(`<tr><td style="${bodyStyle}">`);

  if (data.upcoming_games.length > 0) {
    parts.push(`<div style="${sectionStyle}">`);
    parts.push(
      `<h3 style="${sectionTitleStyle}">Your upcoming games</h3>`,
    );
    parts.push(`<ul style="list-style:none;padding:0;margin:0;">`);
    for (const g of data.upcoming_games) {
      const venue = g.venue_name ?? "Court TBD";
      parts.push(
        `<li style="${liStyle}"><strong>${escapeHtml(g.sport_slug)}</strong> at ` +
          `${escapeHtml(venue)} <span style="${muteStyle}">— ${escapeHtml(fmtWhen(g.starts_at))}</span></li>`,
      );
    }
    parts.push(`</ul></div>`);
  }

  if (data.new_followers.length > 0) {
    parts.push(`<div style="${sectionStyle}">`);
    parts.push(
      `<h3 style="${sectionTitleStyle}">Players who followed you</h3>`,
    );
    parts.push(`<ul style="list-style:none;padding:0;margin:0;">`);
    for (const f of data.new_followers) {
      parts.push(
        `<li style="${liStyle}">${escapeHtml(f.display_name)}</li>`,
      );
    }
    parts.push(`</ul></div>`);
  }

  if (data.friend_activity.length > 0) {
    parts.push(`<div style="${sectionStyle}">`);
    parts.push(`<h3 style="${sectionTitleStyle}">Friend activity</h3>`);
    parts.push(`<ul style="list-style:none;padding:0;margin:0;">`);
    for (const a of data.friend_activity) {
      parts.push(
        `<li style="${liStyle}"><strong>${escapeHtml(a.actor_display_name)}</strong> ` +
          `<span style="${muteStyle}">${escapeHtml(activityLabel(a.type))}</span></li>`,
      );
    }
    parts.push(`</ul></div>`);
  }

  if (data.badges_unlocked.length > 0) {
    parts.push(`<div style="${sectionStyle}">`);
    parts.push(`<h3 style="${sectionTitleStyle}">Badges unlocked</h3>`);
    parts.push(`<ul style="list-style:none;padding:0;margin:0;">`);
    for (const b of data.badges_unlocked) {
      parts.push(
        `<li style="${liStyle}"><strong>${escapeHtml(b.name)}</strong></li>`,
      );
    }
    parts.push(`</ul></div>`);
  }

  parts.push(`</td></tr>`);

  // Footer
  parts.push(`<tr><td style="${footerStyle}">`);
  parts.push(
    `You're receiving this because you opted into the weekly digest. ` +
      `Update your preferences anytime in the Linkfit app.`,
  );
  parts.push(`</td></tr>`);

  parts.push(`</table></body></html>`);
  return parts.join("");
}
