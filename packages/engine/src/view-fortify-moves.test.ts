import { describe, expect, it } from "vitest";
import { applyAction, createSeededRng, testlandRules, viewFor } from "./index.js";
import type { GameState, RuleConfig } from "./index.js";
import { makeState } from "./testkit.js";

// Plan 011, sections 5 and 7: `movesDone` / `movesMax` in the fortify view of the active player and nowhere else;
// the internal counter `fortifyMovesDone` is in no view.

const rng = createSeededRng(1);

function setup(reach: RuleConfig["fortifyReach"], moves: 1 | 2): GameState {
  return makeState({
    phase: "fortify",
    fortifyMoves: moves,
    players: ["a", "b", "c"],
    territories: {
      eisenfurt: ["a", 5],
      rabenhain: ["a", 2],
      tannenfeld: ["a", 3],
      grauwacht: ["b", 2],
      kupferstadt: ["c", 2],
    },
    overrides: { rules: { ...testlandRules, fortifyReach: reach, fortifyMoves: moves } },
  });
}
const fortify = (s: GameState, from: string, to: string, count: number): GameState => {
  const r = applyAction(s, s.activePlayerId, { type: "fortify", from, to, count }, rng);
  if (!r.ok) throw new Error(r.code);
  return r.state;
};
const keys = (v: unknown): string[] =>
  v === null || typeof v !== "object" ? [] : Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]);

describe.each(["connected", "adjacent"] as const)("fortify view with fortifyReach %s", (reach) => {
  it.each([1, 2] as const)(
    "setting %s: movesDone 0 and movesMax = setting before the first move",
    (moves) => {
      const f = viewFor(setup(reach, moves), "a").fortify;
      expect(f).toMatchObject({ reach, movesDone: 0, movesMax: moves });
    },
  );

  it("setting 2: movesDone is 1 after the first move, the lists follow the new position", () => {
    const first = fortify(setup(reach, 2), "eisenfurt", "rabenhain", 4); // A 1, B 6
    const f = viewFor(first, "a").fortify!;
    expect(f).toMatchObject({ reach, movesDone: 1, movesMax: 2 });
    if (f.reach === "connected") {
      expect(f.groups).toEqual([["eisenfurt", "rabenhain", "tannenfeld"]]);
    } else {
      // eisenfurt has 1 army and is no origin any more; rabenhain and tannenfeld are
      expect(f.targets).toEqual({
        rabenhain: ["eisenfurt", "tannenfeld"],
        tannenfeld: ["rabenhain"],
      });
    }
  });

  it("the view is null for the other players, in other phases and after a win", () => {
    const s = setup(reach, 2);
    expect(viewFor(s, "b").fortify).toBeNull();
    expect(viewFor(s, "c").fortify).toBeNull();
    expect(viewFor({ ...s, phase: "attack" }, "a").fortify).toBeNull();
    expect(viewFor({ ...s, winnerId: "a", winReason: "mission" }, "a").fortify).toBeNull();
    const first = fortify(s, "eisenfurt", "rabenhain", 1);
    expect(viewFor(first, "b").fortify).toBeNull();
  });

  it.each([1, 2] as const)(
    "setting %s: the internal counter is in no view (key search over every view)",
    (moves) => {
      let s = setup(reach, moves);
      for (const state of [s, moves === 2 ? fortify(s, "eisenfurt", "rabenhain", 1) : s]) {
        s = state;
        for (const p of ["a", "b", "c"]) {
          const view = viewFor(s, p);
          expect(keys(view)).not.toContain("fortifyMovesDone");
          expect(JSON.stringify(view)).not.toContain("fortifyMovesDone");
          // movesDone / movesMax only inside the active player's fortify field
          const copy = JSON.parse(JSON.stringify(view)) as {
            fortify: Record<string, unknown> | null;
          };
          if (copy.fortify) {
            delete copy.fortify["movesDone"];
            delete copy.fortify["movesMax"];
          }
          expect(keys(copy)).not.toContain("movesDone");
          expect(keys(copy)).not.toContain("movesMax");
        }
      }
    },
  );

  it("the views of the other players differ before and after the first move only by the armies (setting 2)", () => {
    const before = setup(reach, 2);
    const after = fortify(before, "eisenfurt", "rabenhain", 2);
    for (const p of ["b", "c"]) {
      const a = JSON.parse(JSON.stringify(viewFor(before, p))) as Record<string, unknown>;
      const b = JSON.parse(JSON.stringify(viewFor(after, p))) as Record<string, unknown>;
      const ta = a["territories"] as Record<string, { armies: number }>;
      const tb = b["territories"] as Record<string, { armies: number }>;
      delete a["territories"];
      delete b["territories"];
      expect(b).toEqual(a);
      const changed = Object.keys(ta).filter((id) => ta[id]!.armies !== tb[id]!.armies);
      expect(changed.sort()).toEqual(["eisenfurt", "rabenhain"]);
    }
  });
});
