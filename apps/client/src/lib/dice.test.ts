import { describe, expect, it } from "vitest";
import {
  PlaybackGate,
  diceFrames,
  pips,
  planPlayback,
  rollRangeLabel,
  rollingFaces,
  type CombatRecord,
} from "./dice.js";

function combat(rolls: number, opts: { seq?: number; rollCount?: number } = {}): CombatRecord {
  return {
    seq: opts.seq ?? 1,
    attackerId: "a",
    defenderId: "b",
    from: "x",
    to: "y",
    rolls: Array.from({ length: rolls }, (_, i) => ({
      attackerDice: [6 - (i % 3), 2],
      defenderDice: [5, 1 + (i % 4)],
      attackerLosses: i % 2,
      defenderLosses: 1 - (i % 2),
    })),
    summary: {
      rollCount: opts.rollCount ?? rolls,
      attackerLosses: 3,
      defenderLosses: 4,
      conquered: false,
    },
  };
}

describe("planPlayback", () => {
  it("plays a single roll as one step of 900 ms", () => {
    const p = planPlayback(combat(1), { reducedMotion: false });
    expect(p.mode).toBe("single");
    expect(p.steps).toEqual([{ rollIndex: 0, startMs: 0, durationMs: 900 }]);
    expect(p.totalMs).toBe(900);
    expect(p.summaryAtMs).toBeLessThanOrEqual(p.totalMs);
  });
  it("runs a blitz at 150, 150 and 75 ms per roll for 2, 10 and 20 rolls, in 1800 ms at most", () => {
    for (const [n, per] of [
      [2, 150],
      [10, 150],
      [20, 75],
    ] as const) {
      const p = planPlayback(combat(n), { reducedMotion: false });
      expect(p.mode).toBe("blitz");
      expect(p.steps).toHaveLength(n);
      expect(p.steps.every((s) => s.durationMs === per)).toBe(true);
      expect(p.totalMs).toBe(n * per + 300);
      expect(p.totalMs).toBeLessThanOrEqual(1800);
      expect(p.summaryAtMs).toBe(n * per);
    }
  });
  it("starts rising offsets and uses every roll index exactly once", () => {
    const c = combat(13);
    const p = planPlayback(c, { reducedMotion: false });
    expect(p.steps.map((s) => s.rollIndex)).toEqual(c.rolls.map((_, i) => i));
    for (let i = 1; i < p.steps.length; i++) {
      expect(p.steps[i]!.startMs).toBeGreaterThan(p.steps[i - 1]!.startMs);
    }
  });
  it("plays nothing with reduced motion or without rolls", () => {
    expect(planPlayback(combat(5), { reducedMotion: true })).toEqual({
      mode: "none",
      steps: [],
      summaryAtMs: 0,
      totalMs: 0,
    });
    expect(planPlayback(combat(0), { reducedMotion: false }).mode).toBe("none");
  });
  it("does not touch the result data", () => {
    const c = combat(4);
    const before = JSON.stringify(c);
    planPlayback(c, { reducedMotion: false });
    expect(JSON.stringify(c)).toBe(before);
  });
  it("labels a shortened blitz", () => {
    expect(rollRangeLabel(combat(20, { rollCount: 26 }))).toBe("Wurf 7 bis 26 von 26");
    expect(rollRangeLabel(combat(20))).toBeNull();
    expect(rollRangeLabel(combat(1))).toBeNull();
  });
});

describe("PlaybackGate", () => {
  const at = (roomId: string, gameNo: number, c: CombatRecord | null, reducedMotion = false) => ({
    roomId,
    gameNo,
    combat: c,
    reducedMotion,
  });

  it("shows the combat of the first snapshot statically, then animates new ones", () => {
    const g = new PlaybackGate();
    expect(g.decide(at("R", 1, combat(1, { seq: 3 })))).toBe("static");
    expect(g.decide(at("R", 1, combat(1, { seq: 4 })))).toBe("animate");
  });
  it("plays each combat once: a repeated seq is never shown again", () => {
    const g = new PlaybackGate();
    g.decide(at("R", 1, null));
    expect(g.decide(at("R", 1, combat(1, { seq: 1 })))).toBe("animate");
    expect(g.decide(at("R", 1, combat(1, { seq: 1 })))).toBe("none"); // presence change, duplicate delivery
    expect(g.decide(at("R", 1, combat(1, { seq: 1 })))).toBe("none"); // reconnect
  });
  it("animates a combat that arrives right after a reconnect (question 34)", () => {
    const g = new PlaybackGate();
    g.decide(at("R", 1, combat(1, { seq: 1 })));
    // connection lost, a combat happens, the first snapshot of the new connection carries it
    expect(g.decide(at("R", 1, combat(3, { seq: 2 })))).toBe("animate");
  });
  it("never animates with reduced motion, but still shows once", () => {
    const g = new PlaybackGate();
    g.decide(at("R", 1, null));
    expect(g.decide(at("R", 1, combat(1, { seq: 1 }), true))).toBe("static");
    expect(g.decide(at("R", 1, combat(1, { seq: 1 }), true))).toBe("none");
  });
  it("ignores lastCombat null and never goes back in seq", () => {
    const g = new PlaybackGate();
    g.decide(at("R", 1, null));
    expect(g.decide(at("R", 1, combat(1, { seq: 5 })))).toBe("animate");
    expect(g.decide(at("R", 1, null))).toBe("none");
    expect(g.decide(at("R", 1, combat(1, { seq: 5 })))).toBe("none");
    expect(g.decide(at("R", 1, combat(1, { seq: 4 })))).toBe("none");
    expect(g.decide(at("R", 1, combat(1, { seq: 6 })))).toBe("animate");
  });
  it("keeps a memory per game number", () => {
    const g = new PlaybackGate();
    g.decide(at("R", 1, null));
    expect(g.decide(at("R", 1, combat(1, { seq: 2 })))).toBe("animate");
    expect(g.decide(at("R", 2, null))).toBe("none");
    expect(g.decide(at("R", 2, combat(1, { seq: 1 })))).toBe("animate");
  });
  it("keeps rooms apart, each with its own first snapshot", () => {
    const g = new PlaybackGate();
    expect(g.decide(at("A", 1, combat(1, { seq: 1 })))).toBe("static");
    expect(g.decide(at("B", 1, combat(1, { seq: 1 })))).toBe("static");
    expect(g.decide(at("A", 1, combat(1, { seq: 2 })))).toBe("animate");
    expect(g.decide(at("B", 1, combat(1, { seq: 1 })))).toBe("none");
  });
});

describe("dice faces", () => {
  it("has as many pips as the face, inside the face and symmetric", () => {
    for (let face = 1; face <= 6; face++) {
      const p = pips(face);
      expect(p, `face ${face}`).toHaveLength(face);
      for (const [x, y] of p) {
        expect(x).toBeGreaterThan(0.1);
        expect(x).toBeLessThan(0.9);
        expect(y).toBeGreaterThan(0.1);
        expect(y).toBeLessThan(0.9);
        expect(
          p.some(([a, b]) => Math.abs(a - (1 - x)) < 1e-9 && Math.abs(b - (1 - y)) < 1e-9),
        ).toBe(true);
      }
      expect(new Set(p.map(([x, y]) => `${x},${y}`)).size).toBe(face);
    }
  });
  it("has no pips for invalid faces", () => {
    for (const bad of [0, 7, -1, 1.5, NaN]) expect(pips(bad)).toEqual([]);
  });
  it("rolls through a fixed sequence that ends on the real value", () => {
    expect(rollingFaces(4, 5, 2)).toEqual(rollingFaces(4, 5, 2));
    expect(rollingFaces(4, 5, 2)).toEqual([3, 4, 5, 6, 4]);
    for (const [final, count, offset] of [
      [1, 1, 0],
      [6, 8, 3],
      [2, 12, 7],
    ] as const) {
      const f = rollingFaces(final, count, offset);
      expect(f).toHaveLength(count);
      expect(f.at(-1)).toBe(final);
      expect(f.every((v) => v >= 1 && v <= 6)).toBe(true);
    }
    expect(rollingFaces(3, 0, 0)).toEqual([]);
  });
});

describe("diceFrames", () => {
  it("lets a single roll tumble through fixed faces and land on the real values", () => {
    const c = combat(1);
    const p = planPlayback(c, { reducedMotion: false });
    const frames = diceFrames(c, p);
    expect(frames).toHaveLength(7);
    expect(frames.map((f) => f.atMs)).toEqual([0, 100, 200, 300, 400, 500, 600]);
    expect(diceFrames(c, p)).toEqual(frames); // deterministic
    const last = frames.at(-1)!;
    expect(last.attacker).toEqual([6, 2, null]);
    expect(last.defender).toEqual([5, 1]);
    expect([last.attackerLosses, last.defenderLosses]).toEqual([3, 4]);
    for (const f of frames.slice(0, -1)) {
      for (const face of [...f.attacker.slice(0, 2), ...f.defender]) {
        expect(face! >= 1 && face! <= 6).toBe(true);
      }
      expect(f.attacker[2]).toBeNull();
    }
  });
  it("shows each roll of a blitz and counts the losses along to the summary", () => {
    const c = combat(10);
    const p = planPlayback(c, { reducedMotion: false });
    const frames = diceFrames(c, p);
    expect(frames).toHaveLength(11);
    expect(frames.slice(0, 10).map((f) => f.atMs)).toEqual(p.steps.map((s) => s.startMs));
    expect(frames[0]!.attacker).toEqual([6, 2, null]);
    expect(frames[1]!.attacker).toEqual([5, 2, null]);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.attackerLosses).toBeGreaterThanOrEqual(frames[i - 1]!.attackerLosses);
      expect(frames[i]!.defenderLosses).toBeGreaterThanOrEqual(frames[i - 1]!.defenderLosses);
    }
    const end = frames.at(-1)!;
    expect(end.atMs).toBe(p.summaryAtMs);
    expect([end.attackerLosses, end.defenderLosses]).toEqual([3, 4]);
  });
  it("starts the counters of a shortened blitz where the kept rolls begin", () => {
    const c = combat(20, { rollCount: 26 });
    const kept = c.rolls.reduce((n, r) => n + r.attackerLosses, 0);
    const frames = diceFrames(c, planPlayback(c, { reducedMotion: false }));
    expect(frames[0]!.attackerLosses).toBe(3 - kept + c.rolls[0]!.attackerLosses);
    expect(frames.at(-1)!.attackerLosses).toBe(3);
  });
  it("has no frames without playback", () => {
    const c = combat(3);
    expect(diceFrames(c, planPlayback(c, { reducedMotion: true }))).toEqual([]);
  });
});
