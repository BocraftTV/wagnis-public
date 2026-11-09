import { describe, expect, it } from "vitest";
import type { RoomView } from "@wagnis/shared";
import { acceptSnapshot, actionForClose, backoffDelay } from "./policy.js";
import { httpErrorText, wsErrorText } from "./messages.js";
import { httpErrorCodeSchema, wsErrorCodeSchema } from "@wagnis/shared";

const view = (roomId: string, version: number): RoomView => ({
  roomId,
  status: "lobby",
  mapId: "testland",
  version,
  you: { playerId: "p", isHost: true },
  players: [],
  victoryMode: "missions",
  fortifyMoves: 1,
  missionDraft: false,
  holdToWin: false,
  roundLimit: null,
  gameNo: 1,
  publicUrl: null,
  game: null,
});

describe("backoffDelay", () => {
  it("starts at 0.5 s, doubles and caps at 5 s forever", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(backoffDelay)).toEqual([
      500, 1000, 2000, 4000, 5000, 5000, 5000,
    ]);
  });
});

describe("actionForClose", () => {
  it("maps close codes", () => {
    expect(actionForClose(4001)).toBe("rejected");
    expect(actionForClose(4002)).toBe("replaced");
    expect(actionForClose(4003)).toBe("reconnect");
    expect(actionForClose(4004)).toBe("removed"); // removed by the host: forget the token, no reconnect
    expect(actionForClose(1006)).toBe("reconnect");
    expect(actionForClose(1000)).toBe("reconnect");
  });
});

describe("acceptSnapshot", () => {
  it("accepts newer and equal versions (presence changes), rejects older ones", () => {
    expect(acceptSnapshot(null, view("A", 0))).toBe(true);
    expect(acceptSnapshot(view("A", 3), view("A", 4))).toBe(true);
    expect(acceptSnapshot(view("A", 3), view("A", 3))).toBe(true);
    expect(acceptSnapshot(view("A", 3), view("A", 2))).toBe(false);
    expect(acceptSnapshot(view("A", 3), view("B", 0))).toBe(true);
  });
});

describe("messages", () => {
  it("has a German text for every server error code", () => {
    for (const code of httpErrorCodeSchema.options) expect(httpErrorText[code]).toBeTruthy();
    for (const code of wsErrorCodeSchema.options) expect(wsErrorText[code]).toBeTruthy();
  });
});
