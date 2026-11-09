import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { GameState, Mission } from "./index.js";
import { makeState, withMissions } from "./testkit.js";

const players = ["p1", "p2", "p3"];
const draftRules = { ...testlandRules, missionDraft: true };
const key = (m: Mission) => JSON.stringify(m);

function drafted(seed = 3): GameState {
  const r = createGame({
    map: testland,
    rules: draftRules,
    playerIds: players,
    rng: createSeededRng(seed),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function choose(s: GameState, p: string, index: 0 | 1): GameState {
  const r = applyAction(s, p, { type: "chooseMission", index }, createSeededRng(1));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe("view: the mission draft", () => {
  const s0 = drafted();

  it("a player sees only their own offer; nobody sees another one or the dealt cards", () => {
    for (const p of players) {
      const v = viewFor(s0, p);
      expect(v.secret.missionOffer).toEqual(s0.secret.missionOffer[p]);
      expect(v.secret.mission).toBeNull();
      const wire = JSON.stringify(v);
      for (const q of players.filter((x) => x !== p)) {
        // the cards offered to q, as drawn or as shown, appear nowhere in p's view
        for (const m of [...s0.secret.missionOfferDealt[q]!, ...s0.secret.missionOffer[q]!]) {
          const own = s0.secret.missionOffer[p]!.map(key);
          if (own.includes(key(m))) continue; // identical fallback cards are the same text
          expect(wire).not.toContain(key(m));
        }
      }
      expect(wire).not.toContain("missionOfferDealt");
      expect(wire).not.toContain("discardedMission");
    }
  });

  it("publicly only who has chosen, never what", () => {
    let s = choose(s0, "p2", 1);
    for (const p of players) {
      const v = viewFor(s, p);
      expect(v.missionChoice).toEqual({ chosen: ["p2"] });
      expect(v.phase).toBe("missionChoice");
    }
    expect(viewFor(s, "p2").secret.missionOffer).toBeNull();
    expect(viewFor(s, "p2").secret.mission).toEqual(s0.secret.missionOffer["p2"]![1]);
    expect(viewFor(s, "p1").secret.missionOffer).toEqual(s0.secret.missionOffer["p1"]);
    const chosenMission = key(s0.secret.missionOffer["p2"]![1]);
    const otherCard = key(s0.secret.missionOfferDealt["p2"]![0]);
    for (const p of ["p1", "p3"]) {
      const wire = JSON.stringify(viewFor(s, p));
      if (!s0.secret.missionOffer[p]!.map(key).includes(chosenMission))
        expect(wire).not.toContain(chosenMission);
      expect(JSON.stringify(viewFor(s, p).missions)).toBe("null");
      if (!s0.secret.missionOffer[p]!.map(key).includes(otherCard)) {
        expect(wire).not.toContain(otherCard);
      }
    }
    s = choose(choose(s, "p1", 0), "p3", 0);
    expect(viewFor(s, "p1").missionChoice).toBeNull();
    expect(viewFor(s, "p1").phase).toBe("reinforce");
  });

  it("the discarded mission is revealed with the others after the game, and not before", () => {
    let s = choose(choose(choose(s0, "p1", 0), "p2", 1), "p3", 0);
    for (const p of players) {
      expect(JSON.stringify(viewFor(s, p))).not.toContain('discarded":{');
      expect(viewFor(s, p).missions).toBeNull();
    }
    s = { ...s, winnerId: "p1", winReason: "mission" };
    for (const p of players) {
      const reveal = viewFor(s, p).missions!;
      for (const q of players) {
        const dealt = s0.secret.missionOfferDealt[q]!;
        const idx = q === "p2" ? 1 : 0;
        expect(reveal[q]!.mission).toEqual(s0.secret.missionOffer[q]![idx]);
        expect(reveal[q]!.discarded).toEqual(dealt[idx === 0 ? 1 : 0]);
      }
    }
  });
});

describe("view: hold to win", () => {
  const rules = { ...testlandRules, holdToWin: true };
  const base = (pending: Record<string, boolean>) => {
    const s = withMissions(
      makeState({
        territories: { eisenfurt: ["a", 3], nebelkueste: ["b", 1] },
        players: ["a", "b", "c"],
        fill: "c",
        overrides: { rules },
      }),
      { a: { type: "holdTerritories", count: 5, minArmies: 1 }, b: null, c: null },
    );
    return {
      ...s,
      secret: { ...s.secret, victoryPending: { a: false, b: false, c: false, ...pending } },
    };
  };

  it("everybody sees only yes or no; only the owner sees their own marker", () => {
    const s = base({ b: true });
    expect(viewFor(s, "a").victoryPending).toBe(true);
    expect(viewFor(s, "b").victoryPending).toBe(true);
    expect(viewFor(s, "c").victoryPending).toBe(true);
    expect(viewFor(s, "a").secret.victoryPending).toBe(false);
    expect(viewFor(s, "b").secret.victoryPending).toBe(true);
    expect(viewFor(s, "c").secret.victoryPending).toBe(false);
    expect(viewFor(base({}), "a").victoryPending).toBe(false);
  });

  it("the view of two states that differ only in whose marker is set differs only in the own secret", () => {
    const strip = (v: ReturnType<typeof viewFor>) => ({
      ...v,
      secret: { ...v.secret, victoryPending: null },
    });
    expect(strip(viewFor(base({ b: true }), "a"))).toEqual(strip(viewFor(base({ c: true }), "a")));
  });
});

describe("view: mission progress", () => {
  const s = (missions: Record<string, Mission | null>) =>
    withMissions(
      makeState({
        territories: {
          eisenfurt: ["a", 3],
          rabenhain: ["a", 1],
          tannenfeld: ["a", 1],
          dornental: ["a", 1],
        },
        overrides: { conquestsThisTurn: 2, conqueredThisTurn: true },
      }),
      missions,
    );

  it("connectedRealm: the largest group so far and the target", () => {
    const v = viewFor(s({ a: { type: "connectedRealm", count: 5 }, b: null }), "a");
    expect(v.secret.missionProgress).toEqual({ current: 3, target: 5 });
    expect(
      viewFor(s({ a: { type: "connectedRealm", count: 5 }, b: null }), "b").secret.missionProgress,
    ).toBeNull();
  });

  it("blitzkrieg: the counter of the active player, 0 for the others", () => {
    const st = s({ a: { type: "blitzkrieg", count: 6 }, b: { type: "blitzkrieg", count: 3 } });
    expect(viewFor(st, "a").secret.missionProgress).toEqual({ current: 2, target: 6 });
    expect(viewFor(st, "b").secret.missionProgress).toEqual({ current: 0, target: 3 });
    expect(viewFor(st, "a").conquestsThisTurn).toBe(2);
  });

  it("the old kinds have no progress", () => {
    const v = viewFor(s({ a: { type: "holdTerritories", count: 5, minArmies: 1 }, b: null }), "a");
    expect(v.secret.missionProgress).toBeNull();
  });
});
