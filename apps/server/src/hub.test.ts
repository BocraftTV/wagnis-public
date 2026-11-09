import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { Hub } from "./hub.js";
import type { Conn } from "./hub.js";
import type { Store } from "./store.js";

describe("Hub.broadcast", () => {
  it("keeps sending to the other players when one snapshot fails", () => {
    const hub = new Hub({} as Store);
    const conn = (playerId: string): Conn => ({
      socket: {} as WebSocket,
      roomId: "R",
      playerId,
      missedPongs: 0,
    });
    const first = conn("p1");
    const second = conn("p2");
    hub.register(first);
    hub.register(second);
    const sent: string[] = [];
    vi.spyOn(hub, "sendSnapshot").mockImplementation((c) => {
      if (c === first) throw new Error("schema mismatch");
      sent.push(c.playerId);
    });
    expect(() => hub.broadcast("R")).not.toThrow();
    expect(sent).toEqual(["p2"]);
  });
});
