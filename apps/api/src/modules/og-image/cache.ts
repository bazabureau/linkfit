import { type Buffer } from "node:buffer";

/**
 * Bounded in-memory cache for rendered PNG buffers.
 *
 * Keys are arbitrary strings ("game:<id>:<updated_at_iso>"); values are
 * the encoded PNG bytes. Expiry is enforced two ways:
 *   1. TTL — a hard ceiling so stale entries eventually leave even if the
 *      cache is hot. 5 minutes matches the contract we expose externally.
 *   2. LRU — when the map exceeds `maxEntries` the oldest insertion is
 *      evicted. `Map` preserves insertion order, so re-inserting on a hit
 *      promotes the entry naturally.
 *
 * The cache is intentionally process-local — no Redis dependency. If we
 * ever scale beyond one node, the unfurlers (Telegram, WhatsApp, ...)
 * also cache aggressively, so per-pod warm-up is acceptable.
 */
export interface PngCacheEntry {
  buffer: Buffer;
  insertedAt: number;
}

export interface PngCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX = 200;

export class PngCache {
  private readonly entries = new Map<string, PngCacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: PngCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): Buffer | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.insertedAt > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    // LRU promote.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.buffer;
  }

  set(key: string, buffer: Buffer): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { buffer, insertedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
