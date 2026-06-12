import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  interpolate,
  listPushTemplates,
  normalizeLocale,
  renderPushTemplate,
} from "./index.js";

describe("i18n / normalizeLocale", () => {
  it("returns the input when already a supported locale", () => {
    expect(normalizeLocale("az")).toBe("az");
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("ru")).toBe("ru");
  });

  it("strips BCP-47 region suffixes", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("ru-RU")).toBe("ru");
    expect(normalizeLocale("AZ-Latn")).toBe("az");
  });

  it("falls back to az for unknown / empty / nullish input", () => {
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("klingon")).toBe(DEFAULT_LOCALE);
  });
});

describe("i18n / interpolate", () => {
  it("substitutes named placeholders", () => {
    expect(interpolate("{a} → {b}", { a: "x", b: "y" })).toBe("x → y");
  });

  it("collapses missing values to empty strings", () => {
    expect(interpolate("Hello {name}!", {})).toBe("Hello !");
    expect(interpolate("{a}{b}", { a: "ok", b: null })).toBe("ok");
  });

  it("coerces non-string values via String()", () => {
    expect(interpolate("count={n} active={ok}", { n: 5, ok: true })).toBe(
      "count=5 active=true",
    );
  });
});

describe("i18n / renderPushTemplate", () => {
  it("renders AZ copy for the new wave-9 push types", () => {
    const r = renderPushTemplate("feed.comment", "az", {
      actor: "Aydan",
      snippet: "Möhtəşəm oyun!",
    });
    expect(r.title).toBe("Aydan şərh yazdı");
    expect(r.body).toBe("Möhtəşəm oyun!");
  });

  it("renders EN copy when the locale is en", () => {
    const r = renderPushTemplate("squad.invite", "en", {
      inviter: "Murad",
      squad_name: "Baku Aces",
    });
    expect(r.title).toBe("Squad invite");
    expect(r.body).toBe("Murad invited you to 'Baku Aces'");
  });

  it("renders RU copy when the locale is ru", () => {
    const r = renderPushTemplate("squad.accept", "ru", { user: "Анна" });
    expect(r.title).toBe("Новый участник команды");
    expect(r.body).toBe("Анна присоединился(ась) к вашей команде");
  });

  it("falls back to AZ when the locale is unsupported", () => {
    const r = renderPushTemplate("game.invite", "fr", {
      inviter: "Elvin",
      game_title: "Padel @ Sahil",
    });
    expect(r.title).toBe("Oyuna dəvət");
    expect(r.body).toBe("Elvin sizi 'Padel @ Sahil' oyununa dəvət etdi");
  });

  it("ships copy for every (locale, key) pair", () => {
    const rows = listPushTemplates();
    expect(rows.length).toBe(3 * 5); // 3 locales × 5 keys
    for (const row of rows) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.body.length).toBeGreaterThan(0);
    }
  });
});
