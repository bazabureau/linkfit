import { EventEmitter } from "node:events";

/**
 * Generic SSE event payload sent down the wire as `data: <json>\n\n`.
 * Each event has a top-level `kind` so the iOS client can dispatch on it
 * without parsing the wrapped object. The shape is intentionally open —
 * each producing module (notifications, messages) defines its own kind +
 * data convention.
 */
export interface RealtimeEvent {
  kind: string;
  data: Record<string, unknown>;
}

export type UnsubscribeFn = () => void;

/**
 * In-process pub/sub bus for SSE clients. Each subscription is keyed by
 * user_id; producers publish to `user_id` and every active subscriber for
 * that user gets the event delivered through their open response stream.
 *
 * **Single-instance limitation**: this bus is in-memory only. With more
 * than one API instance, an event emitted on box A reaches only the
 * sockets connected to box A. The fix is a Redis pub/sub adapter that
 * sits between this bus and the wider cluster — out of scope here. For a
 * single-instance deployment the in-memory bus is correct and the
 * simplest thing that works.
 *
 * Wraps `EventEmitter` rather than rolling our own listener map so we
 * inherit listener-error isolation and the well-tested removeListener
 * semantics. The user_id is used directly as the event name; an
 * EventEmitter instance can handle ~10k named events without a perf
 * hiccup (it's a JS object under the hood).
 */
export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // EventEmitter warns at 10 listeners per event by default — for SSE
    // we expect a few connections per user (browser + iOS + watch). Bump
    // the cap so the warning doesn't spam logs.
    this.emitter.setMaxListeners(100);
  }

  /** Returns the number of active subscribers for a user. Used by tests
   *  and by the /metrics endpoint to expose a `realtime_subscribers` gauge. */
  subscriberCount(userId: string): number {
    return this.emitter.listenerCount(userId);
  }

  /** Total connections across all users — feeds the active-connections gauge. */
  totalSubscriberCount(): number {
    return this.emitter.eventNames().reduce(
      (acc, name) => acc + this.emitter.listenerCount(name),
      0,
    );
  }

  subscribe(userId: string, listener: (event: RealtimeEvent) => void): UnsubscribeFn {
    this.emitter.on(userId, listener);
    return () => { this.emitter.off(userId, listener); };
  }

  publish(userId: string, event: RealtimeEvent): void {
    this.emitter.emit(userId, event);
  }
}
