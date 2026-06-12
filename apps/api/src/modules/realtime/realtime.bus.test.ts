import { describe, it, expect, vi } from "vitest";
import { RealtimeBus } from "./realtime.bus.js";

describe("RealtimeBus", () => {
  it("delivers a published event to the matching subscriber", () => {
    const bus = new RealtimeBus();
    const handler = vi.fn();
    bus.subscribe("user-1", handler);
    bus.publish("user-1", { kind: "test", data: { hello: 1 } });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ kind: "test", data: { hello: 1 } });
  });

  it("does not deliver to subscribers of a different user_id", () => {
    const bus = new RealtimeBus();
    const aliceHandler = vi.fn();
    const bobHandler = vi.fn();
    bus.subscribe("alice", aliceHandler);
    bus.subscribe("bob", bobHandler);
    bus.publish("alice", { kind: "test", data: {} });
    expect(aliceHandler).toHaveBeenCalledOnce();
    expect(bobHandler).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers for the same user", () => {
    const bus = new RealtimeBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe("user-1", h1);
    bus.subscribe("user-1", h2);
    bus.publish("user-1", { kind: "test", data: {} });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    expect(bus.subscriberCount("user-1")).toBe(2);
  });

  it("unsubscribe removes the listener and stops future delivery", () => {
    const bus = new RealtimeBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("user-1", handler);

    bus.publish("user-1", { kind: "first", data: {} });
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    bus.publish("user-1", { kind: "second", data: {} });
    expect(handler).toHaveBeenCalledOnce(); // still 1
    expect(bus.subscriberCount("user-1")).toBe(0);
  });

  it("totalSubscriberCount sums across users", () => {
    const bus = new RealtimeBus();
    const noop = (): void => { /* noop */ };
    bus.subscribe("a", noop);
    bus.subscribe("a", noop);
    bus.subscribe("b", noop);
    expect(bus.totalSubscriberCount()).toBe(3);
  });

  it("publishing with no subscribers is a silent no-op", () => {
    const bus = new RealtimeBus();
    expect(() => {
      bus.publish("ghost", { kind: "x", data: {} });
    }).not.toThrow();
  });
});
