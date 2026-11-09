import { describe, expect, it } from "vitest";
import { clientMessageSchema } from "@wagnis/shared";
import type { RoomView } from "@wagnis/shared";
import {
  backToLobbyMessage,
  canBackToLobby,
  confirmRemoveText,
  confirmSkipText,
  confirmTransferText,
  genitive,
  hostControls,
  nameWithMark,
  playerStatus,
  removeMessage,
  settingsMessage,
  skipMessage,
  transferMessage,
} from "./host.js";
import { resolutionRows } from "./missions.js";
import { mapOptions, modeHint, modeLabel } from "./mapname.js";

type Row = RoomView["players"][number];
const row = (id: string, o: Partial<Row> = {}): Row => ({
  id,
  name: id.toUpperCase(),
  seat: 0,
  isHost: false,
  connected: true,
  removed: false,
  ...o,
});

function view(o: {
  me: string;
  status?: RoomView["status"];
  players?: Row[];
  active?: string;
  winner?: string | null;
  removed?: string[];
  turn?: number;
}): RoomView {
  const players = o.players ?? [row("a", { isHost: true }), row("b"), row("c")];
  const status = o.status ?? "playing";
  const game =
    status === "lobby"
      ? null
      : ({
          mapId: "testland",
          phase: "attack",
          turn: o.turn ?? 7,
          activePlayerId: o.active ?? "b",
          playerOrder: players.map((p) => p.id),
          removedPlayerIds: o.removed ?? [],
          winnerId: o.winner ?? null,
          territories: Object.fromEntries(
            players
              .filter((p) => !(o.removed ?? []).includes(p.id))
              .map((p, i) => [`t${i}`, { ownerId: p.id, armies: 2, maxAttackDice: 1, maxMove: 1 }]),
          ),
        } as unknown as NonNullable<RoomView["game"]>);
  return {
    roomId: "K7M2XQ",
    status,
    mapId: "testland",
    version: 1,
    you: { playerId: o.me, isHost: players.find((p) => p.id === o.me)!.isHost },
    players,
    victoryMode: "missions",
    fortifyMoves: 1,
    missionDraft: false,
    holdToWin: false,
    roundLimit: null,
    worldEvents: false,
    gameNo: 1,
    publicUrl: null,
    game,
  };
}

describe("hostControls", () => {
  it("a guest sees nothing", () => {
    const c = hostControls(view({ me: "b" }));
    for (const id of ["a", "b", "c"])
      expect(c[id]).toEqual({ skip: false, remove: false, transfer: false });
  });

  it("the host in a running game: skip only on the active row, remove and transfer not on his own row", () => {
    const c = hostControls(view({ me: "a", active: "b" }));
    expect(c["a"]).toEqual({ skip: false, remove: false, transfer: false });
    expect(c["b"]).toEqual({ skip: true, remove: true, transfer: true });
    expect(c["c"]).toEqual({ skip: false, remove: true, transfer: true });
  });

  it("in the mission choice nobody gets the per-player skip (the choice screen has its own button)", () => {
    const v = view({ me: "a" });
    const c = hostControls({ ...v, game: { ...v.game!, phase: "missionChoice" } });
    expect(c["a"]).toEqual({ skip: false, remove: false, transfer: false });
    expect(c["b"]).toEqual({ skip: false, remove: true, transfer: true });
  });

  it("the host may skip his own turn, but not remove or hand over to himself", () => {
    const c = hostControls(view({ me: "a", active: "a" }));
    expect(c["a"]).toEqual({ skip: true, remove: false, transfer: false });
  });

  it("lobby: remove and transfer, no skip", () => {
    const c = hostControls(view({ me: "a", status: "lobby" }));
    expect(c["b"]).toEqual({ skip: false, remove: true, transfer: true });
    expect(c["a"]).toEqual({ skip: false, remove: false, transfer: false });
  });

  it("after the end: no skip, no remove; the handover stays possible", () => {
    const c = hostControls(view({ me: "a", status: "finished", winner: "b", active: "b" }));
    expect(c["b"]).toEqual({ skip: false, remove: false, transfer: true });
  });

  it("removed players get nothing; a handover is offered only to a connected player", () => {
    const players = [
      row("a", { isHost: true }),
      row("b", { removed: true }),
      row("c", { connected: false }),
    ];
    const c = hostControls(view({ me: "a", players, removed: ["b"], active: "c" }));
    expect(c["b"]).toEqual({ skip: false, remove: false, transfer: false });
    expect(c["c"]).toEqual({ skip: true, remove: true, transfer: false });
  });

  it("after a handover the controls move with the host mark", () => {
    const players = [row("a"), row("b", { isHost: true }), row("c")];
    // the old host is a guest now and sees nothing; the new host sees the controls
    const none = { skip: false, remove: false, transfer: false };
    expect(hostControls(view({ me: "a", players }))["b"]).toEqual(none);
    const c = hostControls(view({ me: "b", players, active: "b" }));
    expect(c["a"]).toEqual({ skip: false, remove: true, transfer: true });
    expect(c["b"]).toEqual({ skip: true, remove: false, transfer: false });
  });

  it("back to the lobby: only the host, only when finished", () => {
    expect(canBackToLobby(view({ me: "a", status: "finished", winner: "b" }))).toBe(true);
    expect(canBackToLobby(view({ me: "b", status: "finished", winner: "b" }))).toBe(false);
    expect(canBackToLobby(view({ me: "a" }))).toBe(false);
    expect(canBackToLobby(view({ me: "a", status: "lobby" }))).toBe(false);
  });
});

describe("messages", () => {
  it("the skip message takes the turn from the view, never from a calculation", () => {
    const v = view({ me: "a", turn: 12 });
    expect(skipMessage(v.game!)).toEqual({ type: "host", action: { type: "skipTurn", turn: 12 } });
  });

  it("every message is valid on the wire", () => {
    for (const m of [
      skipMessage({ turn: 3 }),
      removeMessage("9a2e"),
      transferMessage("9a2e"),
      backToLobbyMessage(),
      settingsMessage({ mapId: "welt" }),
      settingsMessage({ victoryMode: "domination" }),
      settingsMessage({ mapId: "testland", victoryMode: "missions" }),
      settingsMessage({ fortifyMoves: 1 }),
      settingsMessage({ fortifyMoves: 2 }),
      settingsMessage({ victoryMode: "domination", fortifyMoves: 2 }),
      settingsMessage({ missionDraft: true }),
      settingsMessage({ holdToWin: false, missionDraft: true }),
      settingsMessage({ roundLimit: 12 }),
      settingsMessage({ roundLimit: null }),
    ]) {
      expect(clientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
    expect(removeMessage("x")).toEqual({
      type: "host",
      action: { type: "removePlayer", playerId: "x" },
    });
    expect(transferMessage("x")).toEqual({
      type: "host",
      action: { type: "transferHost", playerId: "x" },
    });
  });
});

describe("playerStatus", () => {
  it("removed wins over eliminated; no territory means out; otherwise in", () => {
    const v = view({
      me: "a",
      removed: ["c"],
      players: [row("a", { isHost: true }), row("b"), row("c")],
    });
    const g = v.game!;
    // b holds a territory, c was removed
    expect(playerStatus(g, "a")).toBe("active");
    expect(playerStatus(g, "c")).toBe("removed");
    // d holds nothing and was not removed
    expect(playerStatus({ ...g, playerOrder: [...g.playerOrder, "d"] }, "d")).toBe("eliminated");
  });
});

describe("dialog texts", () => {
  it("name the player; the removal text depends on the room status and promises nothing about pronouns", () => {
    expect(confirmSkipText("Anna")).toBe(
      "Annas Zug beenden? Noch nicht gesetzte Verstärkungen verfallen.",
    );
    expect(confirmSkipText("Max")).toBe(
      "Max' Zug beenden? Noch nicht gesetzte Verstärkungen verfallen.",
    );
    expect(confirmRemoveText("Ben", "playing")).toBe(
      "Ben entfernen? Die Gebiete von Ben werden neutral, die Karten kommen aus dem Spiel. Das lässt sich nicht rückgängig machen.",
    );
    expect(confirmRemoveText("Ben", "lobby")).toBe(
      "Ben entfernen? Der Platz wird frei, Ben kann neu beitreten.",
    );
    expect(confirmTransferText("Cleo")).toBe(
      "Cleo zum Host machen? Du verlierst die Host-Rechte (Überspringen, Entfernen, Einstellungen). Cleo kann dich danach entfernen.",
    );
    expect(genitive("Moritz")).toBe("Moritz'");
    expect(genitive("Jonas")).toBe("Jonas'");
    expect(genitive("Ben")).toBe("Bens");
  });
});

describe("removed players in the resolution", () => {
  it("the name of a removed target carries the mark, the removed player has no row", () => {
    const names: Record<string, [string, boolean]> = { a: ["Anna", false], b: ["Ben", true] };
    const ctx = {
      continentName: (id: string) => id,
      playerName: (id: string) => nameWithMark(names[id]![0], names[id]![1]),
    };
    const rows = resolutionRows(
      {
        a: {
          mission: { type: "holdTerritories", count: 6, minArmies: 2 },
          originalMission: { type: "eliminatePlayer", targetPlayerId: "b" },
          discarded: null,
        },
      },
      ["a", "b"],
      "a",
      ctx,
    )!;
    expect(rows.map((r) => r.playerId)).toEqual(["a"]);
    expect(rows[0]!.original).toBe("Schalte Ben (entfernt) aus");
    expect(nameWithMark("Ben", false)).toBe("Ben");
  });
});

describe("lobby choice labels", () => {
  it("labels the two modes with one sentence each, and offers testland only in a development build", () => {
    expect(modeLabel("missions")).toBe("Geheime Missionen");
    expect(modeLabel("domination")).toBe("Letzter Spieler gewinnt");
    expect(modeHint("missions")).toMatch(/Mission/);
    expect(modeHint("domination")).toMatch(/Letzter|letzter/i);
    expect(mapOptions(false).map((o) => o.id)).toEqual(["welt"]);
    expect(mapOptions(true).map((o) => o.id)).toEqual(["welt", "testland"]);
    expect(mapOptions(false)[0]!.label).toBe("Welt");
  });
});
