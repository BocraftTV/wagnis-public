// Plan 016, step 0: writes the fixed room views for the client golden test (apps/client/src/golden/views.json).
// The views come from random games over the real engine (playbot, with fixed seeds), wrapped the way the server
// wraps them (hub.ts `buildView`). Run with tsx, because the engine sources and the playbot are TypeScript:
//   npx tsx scripts/make-golden-views.mjs
// Only needed again when the golden test should cover more cases; the views do not have to follow engine changes.
import { writeFileSync } from "node:fs";
import {
  teamOf,
  testland,
  testlandRules,
  viewFor,
  welt,
  weltRules,
} from "../packages/engine/src/index.ts";
import { playRandomGame } from "../packages/engine/src/playbot.ts";

const OUT = new URL("../apps/client/src/golden/views.json", import.meta.url);
const names = ["Anna", "Ben", "Cem", "Dora", "Emil", "Frida"];
const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];

function teamsFor(mode, n) {
  if (mode === null) return undefined;
  const count = mode === "2v2v2" ? 3 : 2;
  const teams = {};
  for (let i = 0; i < n; i++) (teams[["A", "B", "C"][i % count]] ??= []).push(ids[i]);
  return teams;
}

/** The room view of `playerId`, as hub.ts builds it; `p1` is the host, every third player is offline. */
function roomView(state, playerId, status, version) {
  const players = ids.slice(0, Object.keys(state.secret.hand).length);
  return {
    roomId: "K7M2XQ",
    status,
    mapId: state.mapId,
    version,
    you: { playerId, isHost: playerId === "p1" },
    players: players.map((id, seat) => ({
      id,
      name: names[seat],
      seat,
      isHost: id === "p1",
      connected: seat % 3 !== 2,
      removed: state.removedPlayerIds.includes(id),
      team: teamOf(state, id),
    })),
    victoryMode: state.rules.victoryMode,
    fortifyMoves: state.rules.fortifyMoves,
    missionDraft: state.rules.missionDraft,
    holdToWin: state.rules.holdToWin,
    roundLimit: state.rules.roundLimit,
    worldEvents: state.rules.worldEvents,
    teams: state.rules.teams,
    gameNo: 2,
    publicUrl: null,
    game: viewFor(state, playerId),
  };
}

const games = [];
const add = (label, opts) => {
  for (const seed of opts.seeds ?? [1, 2, 3, 4, 5, 6]) {
    const teams = teamsFor(opts.rules.teams ?? null, opts.players);
    const { start, steps } = playRandomGame({
      seed,
      players: opts.players,
      map: opts.map ?? testland,
      rules: opts.rules,
      extra: teams ? { teams } : {},
      hostRate: opts.hostRate ?? 0,
      aggression: opts.aggression ?? 0.9,
      maxActions: opts.maxActions ?? 400,
    });
    games.push({ label: `${label} #${seed}`, states: [start, ...steps.map((s) => s.after)] });
  }
};
const base = testlandRules;
add("3p missions host", { players: 3, rules: base, hostRate: 0.02 });
add("2p domination", { players: 2, rules: { ...base, victoryMode: "domination" } });
add("4p two moves", { players: 4, rules: { ...base, fortifyMoves: 2, victoryMode: "domination" } });
add("4p draft hold", { players: 4, rules: { ...base, missionDraft: true, holdToWin: true } });
add("5p events", {
  players: 5,
  rules: { ...base, worldEvents: true },
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
});
add("3p round limit", {
  players: 3,
  rules: { ...base, roundLimit: 8, victoryMode: "domination" },
  aggression: 0.1,
  maxActions: 3000,
});
add("4p teams round limit", {
  players: 4,
  rules: { ...base, teams: "2v2", roundLimit: 8 },
  aggression: 0.1,
  maxActions: 3000,
});
add("6p teams 2v2v2", {
  players: 6,
  rules: { ...base, teams: "2v2v2", victoryMode: "domination" },
  maxActions: 1500,
});
add("6p teams 3v3 missions", { players: 6, rules: { ...base, teams: "3v3" }, maxActions: 1500 });
add("welt 4p missions", {
  players: 4,
  map: welt,
  rules: weltRules,
  seeds: [1, 2],
  maxActions: 2000,
});
add("welt 3p events", {
  players: 3,
  map: welt,
  rules: { ...weltRules, worldEvents: true },
  seeds: [1],
  maxActions: 200,
});

/** Each case: the first state (in the order above) where `pick` names a viewer. */
const cases = {
  "reinforce, must trade": (s) =>
    s.phase === "reinforce" && viewFor(s, s.activePlayerId).secret.mustTrade
      ? s.activePlayerId
      : null,
  "reinforce, may trade": (s) =>
    s.phase === "reinforce" &&
    !viewFor(s, s.activePlayerId).secret.mustTrade &&
    s.secret.hand[s.activePlayerId].length >= 3
      ? s.activePlayerId
      : null,
  "reinforce, other player": (s) => (s.phase === "reinforce" && s.turn > 3 ? other(s) : null),
  "attack, after a combat": (s) =>
    s.phase === "attack" && s.lastCombat && !s.pendingOccupation && s.winnerId === null
      ? s.activePlayerId
      : null,
  "attack, after a trade": (s) =>
    s.phase === "attack" && s.lastTrade && s.winnerId === null ? s.activePlayerId : null,
  "occupy, own": (s) => (s.pendingOccupation && s.winnerId === null ? s.activePlayerId : null),
  "occupy, other player": (s) => (s.pendingOccupation && s.winnerId === null ? other(s) : null),
  "fortify, first move": (s) =>
    s.phase === "fortify" && s.fortifyMovesDone === 0 ? s.activePlayerId : null,
  "fortify, second move": (s) =>
    s.phase === "fortify" && s.fortifyMovesDone === 1 && s.rules.fortifyMoves === 2
      ? s.activePlayerId
      : null,
  "mission choice": (s) => (s.phase === "missionChoice" ? "p2" : null),
  "hold to win pending, own": (s) =>
    s.winnerId === null
      ? (Object.entries(s.secret.victoryPending).find(([, v]) => v)?.[0] ?? null)
      : null,
  "hold to win pending, other": (s) => {
    const p =
      s.winnerId === null
        ? Object.entries(s.secret.victoryPending).find(([, v]) => v)?.[0]
        : undefined;
    return p ? s.playerOrder.find((x) => x !== p) : null;
  },
  "removed player": (s) => (s.removedPlayerIds.length > 0 && s.winnerId === null ? "p1" : null),
  "neutral owner": (s) =>
    s.winnerId === null &&
    Object.values(s.territories).some((t) => t.ownerId === null) &&
    s.phase === "attack"
      ? s.activePlayerId
      : null,
  "fog, other player": (s) =>
    s.worldEvent?.kind === "fog" && s.winnerId === null ? other(s) : null,
  "fog, occupy of another": (s) =>
    s.worldEvent?.kind === "fog" && s.pendingOccupation && s.winnerId === null ? other(s) : null,
  ...Object.fromEntries(
    ["storm", "goldRush", "plague", "mobilize", "truce", "rebellion", "cardFlood"].map((kind) => [
      `event ${kind}`,
      (s) => (s.worldEvent?.kind === kind && s.winnerId === null ? s.activePlayerId : null),
    ]),
  ),
  "teams, partner hand": (s) =>
    s.teams && s.winnerId === null && s.phase === "reinforce" && s.turn > 4
      ? s.activePlayerId
      : null,
  "won by mission, winner (host)": (s) =>
    s.winReason === "mission" && s.winnerId === "p1" ? "p1" : null,
  "won by mission, loser (guest)": (s) =>
    s.winReason === "mission" && s.winnerId !== null && s.teams === null ? loser(s) : null,
  "won by domination, host loses": (s) =>
    s.winnerId !== null &&
    s.winReason !== "mission" &&
    s.winReason !== "roundLimit" &&
    s.winnerId !== "p1"
      ? "p1"
      : null,
  "round limit, single winner": (s) =>
    s.winReason === "roundLimit" && s.winnerIds.length === 1 && s.teams === null ? "p2" : null,
  "round limit, teams": (s) => (s.winReason === "roundLimit" && s.teams ? "p1" : null),
  "team won by mission": (s) => (s.teams && s.winReason === "mission" ? "p2" : null),
  "team won by domination": (s) =>
    s.teams && s.winnerId !== null && s.winReason !== "mission" && s.winReason !== "roundLimit"
      ? "p3"
      : null,
  "welt attack": (s) =>
    s.mapId === "welt" && s.phase === "attack" && s.lastCombat && s.winnerId === null
      ? s.activePlayerId
      : null,
  "welt finished": (s) => (s.mapId === "welt" && s.winnerId !== null ? "p2" : null),
};
function other(s) {
  return (
    s.playerOrder.find((p) => p !== s.activePlayerId && !s.removedPlayerIds.includes(p)) ?? null
  );
}
function loser(s) {
  return s.playerOrder.find((p) => !s.winnerIds.includes(p)) ?? null;
}

const views = {};
const missing = [];
for (const [name, pick] of Object.entries(cases)) {
  let found = null;
  for (const g of games) {
    for (const s of g.states) {
      const viewer = pick(s);
      if (viewer) {
        found = {
          from: g.label,
          view: roomView(s, viewer, s.winnerId === null ? "playing" : "finished", 40),
        };
        break;
      }
    }
    if (found) break;
  }
  if (found) views[name] = found;
  else missing.push(name);
}

// Lobby: host and guest, every setting, with and without teams and QR address.
const lobby = (n, you, settings, extra = {}) => ({
  roomId: "K7M2XQ",
  status: "lobby",
  mapId: settings.mapId ?? "testland",
  version: 7,
  you: { playerId: you, isHost: you === "p1" },
  players: ids.slice(0, n).map((id, seat) => ({
    id,
    name: names[seat],
    seat,
    isHost: id === "p1",
    connected: seat !== 1,
    removed: false,
    team: settings.assign?.[id] ?? null,
  })),
  victoryMode: settings.victoryMode ?? "missions",
  fortifyMoves: settings.fortifyMoves ?? 1,
  missionDraft: settings.missionDraft ?? false,
  holdToWin: settings.holdToWin ?? false,
  roundLimit: settings.roundLimit ?? null,
  worldEvents: settings.worldEvents ?? false,
  teams: settings.teams ?? null,
  gameNo: 1,
  publicUrl: settings.publicUrl ?? null,
  game: null,
  ...extra,
});
const lobbies = {
  "host, 1 player, defaults": lobby(1, "p1", {}),
  "host, 3 players, defaults": lobby(3, "p1", {}),
  "guest, 3 players, defaults": lobby(3, "p2", {}),
  "host, everything on, welt": lobby(5, "p1", {
    mapId: "welt",
    fortifyMoves: 2,
    missionDraft: true,
    holdToWin: true,
    roundLimit: 12,
    worldEvents: true,
    publicUrl: "https://wagnis.example",
  }),
  "guest, everything on, welt": lobby(5, "p3", {
    mapId: "welt",
    fortifyMoves: 2,
    missionDraft: true,
    holdToWin: true,
    roundLimit: 16,
    worldEvents: true,
    publicUrl: "https://wagnis.example",
  }),
  "host, domination": lobby(2, "p1", { victoryMode: "domination", roundLimit: 8 }),
  "guest, domination": lobby(2, "p2", { victoryMode: "domination" }),
  "host, 2v2 assigned": lobby(4, "p1", {
    teams: "2v2",
    assign: { p1: "A", p2: "B", p3: "A", p4: "B" },
  }),
  "host, 2v2 partly assigned": lobby(4, "p1", {
    teams: "2v2",
    assign: { p1: "A", p2: "A", p3: "A" },
  }),
  "guest, 3v3": lobby(6, "p4", {
    teams: "3v3",
    assign: { p1: "A", p2: "B", p3: "A", p4: "B", p5: "A", p6: "B" },
  }),
  "host, 2v2v2 wrong count": lobby(5, "p1", {
    teams: "2v2v2",
    assign: { p1: "A", p2: "B", p3: "C" },
  }),
  "host, 2v2v2": lobby(6, "p1", {
    teams: "2v2v2",
    assign: { p1: "A", p2: "B", p3: "C", p4: "A", p5: "B", p6: "C" },
  }),
};

// Compact: one line per view (the file is in .prettierignore), so the fixture stays small in a diff.
const block = (entries) =>
  entries
    .map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
    .join(",\n");
writeFileSync(
  OUT,
  `{\n  "games": {\n${block(Object.entries(views))}\n  },\n  "lobbies": {\n${block(Object.entries(lobbies))}\n  }\n}\n`,
);
console.log(`views: ${Object.keys(views).length}, lobbies: ${Object.keys(lobbies).length}`);
if (missing.length > 0) console.log(`no state found for: ${missing.join(", ")}`);
