// First round: two players, a full round of two turns with attack, conquest, card and fortify.
import { join } from "node:path";
import Database from "better-sqlite3";
import { tmp, createCode, check, getMap, Client, startServer, stopServer, until } from "./lib.mjs";

let combats = 0; // lastCombat.seq keeps counting across turns

/** Blitzes from any legal pair until the turn has a conquest (so that the turn ends with a drawn card). */
async function conquer(active) {
  const map = getMap("testland");
  for (let attempt = 0; attempt < 6 && !active.view.game.conqueredThisTurn; attempt++) {
    const g = active.view.game;
    const me = g.activePlayerId;
    const pairs = [];
    for (const [from, t] of Object.entries(g.territories)) {
      if (t.ownerId !== me || t.maxAttackDice < 1) continue;
      for (const to of map.territories.find((x) => x.id === from).neighbors) {
        if (g.territories[to].ownerId !== me) pairs.push({ from, to });
      }
    }
    if (pairs.length === 0 || g.winnerId) return;
    const seq = g.lastCombat?.seq ?? 0;
    active.send({ type: "action", action: { type: "blitz", ...pairs[0] } });
    await active.until(
      (v) => (v.game.lastCombat?.seq ?? 0) > seq || v.game.winnerId,
      "extra blitz",
    );
    combats = active.view.game.lastCombat?.seq ?? combats;
    const pending = active.view.game.pendingOccupation;
    if (pending) {
      active.send({ type: "action", action: { type: "occupy", count: pending.max } });
      await active.until((v) => v.game.pendingOccupation === null, "occupy");
    }
  }
}

/** Fortify phase: turn 1 moves armies for real (the turn then ends by itself), turn 2 skips with endPhase. */
async function finishTurn(turn, active, byId, names) {
  const g = active.view.game;
  const me = g.activePlayerId;
  const observer = Object.values(byId).find((c) => c !== active);
  const conquered = g.conqueredThisTurn;
  const handBefore = g.secret.hand.map((c) => c.id);
  let move = null;
  if (turn === 1 && g.fortify?.reach === "connected") {
    for (const group of g.fortify.groups) {
      const from = group.find((id) => g.territories[id].maxMove > 0);
      const to = group.find((id) => id !== from);
      if (from && to) {
        move = { from, to, count: g.territories[from].maxMove };
        break;
      }
    }
  }
  const before = move && {
    from: g.territories[move.from].armies,
    to: g.territories[move.to].armies,
  };
  active.send({
    type: "action",
    action: move ? { type: "fortify", ...move } : { type: "endPhase" },
  });
  await active.until((v) => v.game.turn === turn + 1 && v.game.phase === "reinforce", "turn end");
  const after = active.view.game.territories;
  if (move) {
    check(
      after[move.from].armies === before.from - move.count &&
        after[move.to].armies === before.to + move.count,
      `turn ${turn}: fortify moved ${move.count} armies ${move.from} -> ${move.to}, the turn ended by itself`,
    );
  } else {
    console.log(
      `   turn ${turn}: ${turn === 1 ? "no fortify option, skipped" : "fortify skipped (endPhase)"}`,
    );
  }
  const mine = active.view.game;
  const seen = observer.view.game;
  const expected = handBefore.length + (conquered ? 1 : 0);
  check(
    mine.secret.hand.length === expected && mine.handCounts[me] === expected,
    `turn ${turn}: ${conquered ? "conquest -> exactly one card drawn" : "no conquest -> no card"} (hand ${expected})`,
  );
  const drawn = mine.secret.hand.map((c) => c.id).filter((id) => !handBefore.includes(id));
  check(
    seen.handCounts[me] === expected && !seen.secret.hand.some((c) => drawn.includes(c.id)),
    `turn ${turn}: the other player sees the count (${seen.handCounts[me]}) but none of the cards`,
  );
  check(
    drawn.every((id) => !observer.raw.join("\n").includes(id)),
    `turn ${turn}: the drawn card id never reached the other player's connection`,
  );
}

/** One combat in the attack phase: turn 1 an attack with maximum dice, turn 2 a blitz. */
async function fight(turn, active, byId, names) {
  const [anna, ben] = [byId[Object.keys(byId)[0]], byId[Object.keys(byId)[1]]];
  const g = active.view.game;
  const me = g.activePlayerId;
  const map = getMap("testland");
  let pick;
  for (const [from, t] of Object.entries(g.territories)) {
    if (t.ownerId !== me || t.maxAttackDice < 1) continue;
    const to = map.territories
      .find((x) => x.id === from)
      .neighbors.find((n) => g.territories[n].ownerId !== me);
    if (to) pick = { from, to, dice: t.maxAttackDice };
  }
  if (!pick) throw new Error(`turn ${turn}: no legal attack found`);
  check(g.lastCombat === null, `turn ${turn}: lastCombat is empty at the start of the turn`);
  console.log(
    `== turn ${turn}: ${names[me]} ${turn === 1 ? "attacks" : "blitzes"} ${pick.from} -> ${pick.to}`,
  );
  const version = active.view.version;
  active.send({
    type: "action",
    action:
      turn === 1 ? { type: "attack", ...pick } : { type: "blitz", from: pick.from, to: pick.to },
  });
  const [va, vb] = await Promise.all([
    anna.until((v) => v.game.lastCombat !== null, "combat seen by Anna"),
    ben.until((v) => v.game.lastCombat !== null, "combat seen by Ben"),
  ]);
  const c = va.game.lastCombat;
  check(
    JSON.stringify(c) === JSON.stringify(vb.game.lastCombat),
    `turn ${turn}: both players see the same dice`,
  );
  check(
    c.seq === combats + 1,
    `turn ${turn}: lastCombat.seq is ${c.seq} (keeps counting after the clear)`,
  );
  check(va.version === version + 1, `turn ${turn}: one version bump for the whole combat`);
  const dieOk = (d) => d.every((x) => Number.isInteger(x) && x >= 1 && x <= 6);
  check(
    c.rolls.length >= 1 &&
      c.rolls.every((r) => dieOk(r.attackerDice) && dieOk(r.defenderDice)) &&
      (turn !== 1 || c.rolls[0].attackerDice.length === pick.dice),
    `turn ${turn}: dice are in the snapshot (${c.summary.rollCount} roll(s), losses ${c.summary.attackerLosses}/${c.summary.defenderLosses})`,
  );
  combats = c.seq;
  const pending = va.game.pendingOccupation;
  if (pending) {
    active.send({ type: "action", action: { type: "occupy", count: pending.max } });
    await active.until((v) => v.game.pendingOccupation === null, "occupy");
    check(true, `turn ${turn}: conquered, moved in ${pending.max} armies`);
  }
  check(active.view.game.lastCombat.seq === c.seq, `turn ${turn}: occupy keeps lastCombat`);
}

/** 2 players: three owners (the neutral one is `null`), one mission each, nobody sees the other's. */
function startChecks2p(anna, ben, annaId, benId) {
  const g = anna.view.game;
  const count = { [annaId]: 0, [benId]: 0, neutral: 0 };
  const armies = { [annaId]: 0, [benId]: 0, neutral: 0 };
  for (const t of Object.values(g.territories)) {
    const key = t.ownerId === null ? "neutral" : t.ownerId;
    count[key] += 1;
    armies[key] += t.armies;
  }
  const counts = Object.values(count);
  check(
    Math.max(...counts) - Math.min(...counts) <= 1 && counts.every((n) => n > 0),
    `2 players: territories split over three owners (${counts.join("/")}), the third is Neutral (ownerId null)`,
  );
  check(
    new Set(Object.values(armies)).size === 1,
    `2 players: every owner, Neutral included, starts with ${Object.values(armies)[0]} armies`,
  );
  check(
    g.playerOrder.length === 2 &&
      !g.playerOrder.includes(null) &&
      Object.keys(g.handCounts).length === 2 &&
      anna.view.players.length === 2,
    "Neutral is no seat: not in playerOrder, handCounts or the player list",
  );
  const ma = g.secret.mission;
  const mb = ben.view.game.secret.mission;
  check(
    ma !== null &&
      mb !== null &&
      ma.type !== "eliminatePlayer" &&
      mb.type !== "eliminatePlayer" &&
      JSON.stringify(ma) !== JSON.stringify(mb),
    "2 players: each has a different map mission, no elimination mission",
  );
  check(
    g.victoryMode === "missions" &&
      g.winReason === null &&
      g.missions === null &&
      g.secret.missionReplaced === false,
    "victoryMode missions; no winReason, no resolution, no replacement before the end",
  );
  check(
    !anna.raw.join("\n").includes(JSON.stringify(mb)) &&
      !ben.raw.join("\n").includes(JSON.stringify(ma)),
    "the other player's mission is on neither connection",
  );
  const wire = [...anna.raw, ...ben.raw].join("\n");
  check(
    !wire.includes("originalMission") && !wire.includes("stateVersion"),
    "no originalMission and no stateVersion on the wire before the end",
  );
}

/** The first part: wrong create code, a room with two players, the start, then one full round of two turns. */
export async function firstRoundSection({ port, base, post }) {
  const bad = await post("/api/rooms", { createCode: "definitely-wrong", hostName: "X" });
  check(bad.status === 403, "wrong create code rejected (403)");
  const created = await post("/api/rooms", { createCode, hostName: "Anna", mapId: "testland" });
  check(created.status === 201, "room created");
  const roomId = created.body.roomId;
  const joined = await post(`/api/rooms/${roomId}/join`, { name: "Ben" });
  check(joined.status === 200, "second player joined");
  console.log(`   room ${roomId.slice(0, 3)}-${roomId.slice(3)}`);

  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  let anna = new Client("Anna", wsUrl);
  let ben = new Client("Ben", wsUrl);
  await Promise.all([anna.ready, ben.ready]);
  anna.send({ type: "hello", roomId, token: created.body.playerToken });
  ben.send({ type: "hello", roomId, token: joined.body.playerToken });
  await anna.until(
    (v) => v.players.length === 2 && v.players.every((p) => p.connected),
    "both connected",
  );
  check(true, "both clients connected, lobby snapshot received");

  anna.send({ type: "start" });
  await Promise.all([
    anna.until((v) => v.status === "playing", "start"),
    ben.until((v) => v.status === "playing", "start"),
  ]);
  check(true, "game started by host");

  startChecks2p(anna, ben, created.body.playerId, joined.body.playerId);

  // The round below is random: a mission could be met by accident and end the game. Give both players the hardest
  // mission in the saved state (this also covers a restart right after the start), then reconnect.
  anna.ws.close();
  ben.ws.close();
  await stopServer();
  {
    const db = new Database(join(tmp, "smoke.db"));
    const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId);
    const state = JSON.parse(row.state_json);
    const unreachable = {
      type: "conquerContinents",
      continentIds: ["nordreich"],
      extraContinents: 1,
    };
    for (const id of state.playerOrder) {
      state.secret.mission[id] = unreachable;
      state.secret.originalMission[id] = unreachable;
      state.secret.missionReplaced[id] = false;
    }
    db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
    db.close();
  }
  await startServer(port, base);
  anna = new Client("Anna", wsUrl);
  ben = new Client("Ben", wsUrl);
  await Promise.all([anna.ready, ben.ready]);
  anna.send({ type: "hello", roomId, token: created.body.playerToken });
  ben.send({ type: "hello", roomId, token: joined.body.playerToken });
  await Promise.all([
    anna.until((v) => v.game?.turn === 1, "restored game"),
    ben.until((v) => v.game?.turn === 1, "restored game"),
  ]);
  const byId = { [created.body.playerId]: anna, [joined.body.playerId]: ben };
  const names = { [created.body.playerId]: "Anna", [joined.body.playerId]: "Ben" };
  const startVersion = anna.view.version;

  for (let turn = 1; turn <= 2; turn++) {
    const g = anna.view.game;
    const active = byId[g.activePlayerId];
    const mine = Object.entries(g.territories)
      .filter(([, t]) => t.ownerId === g.activePlayerId)
      .map(([id]) => id);
    console.log(
      `== turn ${turn}: ${names[g.activePlayerId]} reinforces ${g.reinforcementsLeft} armies`,
    );
    // place the whole pool, spread over own territories (1 per action as the client does)
    for (let i = 0, left = g.reinforcementsLeft; left > 0; i++, left--) {
      const target = mine[i % mine.length];
      const before = active.view.game.territories[target].armies;
      active.send({
        type: "action",
        action: { type: "placeArmies", territoryId: target, count: 1 },
      });
      await active.until((v) => v.game.territories[target].armies === before + 1, "placeArmies");
    }
    check(
      active.view.game.reinforcementsLeft === 0,
      `${names[g.activePlayerId]} placed all armies`,
    );
    active.send({ type: "action", action: { type: "endPhase" } });
    await active.until((v) => v.game.phase === "attack", "phase attack");
    await fight(turn, active, byId, names);
    await conquer(active);
    active.send({ type: "action", action: { type: "endPhase" } });
    await active.until((v) => v.game.phase === "fortify", "phase fortify");
    await finishTurn(turn, active, byId, names);
  }

  const final = anna.view;
  check(
    final.game.turn === 3 && final.game.phase === "reinforce",
    "a complete round (two turns) was played",
  );
  check(final.version > startVersion, `version advanced ${startVersion} -> ${final.version}`);
  check(ben.view.version === final.version, "both players see the same version");
  const owners = {};
  for (const t of Object.values(final.game.territories)) {
    const label = t.ownerId === null ? "Neutral" : names[t.ownerId];
    owners[label] = (owners[label] ?? 0) + t.armies;
  }
  console.log(
    `   armies on board: ${JSON.stringify(owners)}, active: ${names[final.game.activePlayerId]}`,
  );

  const wire = [...anna.raw, ...ben.raw].join("\n");
  check(
    ![
      createCode,
      created.body.playerToken,
      joined.body.playerToken,
      "tokenHash",
      "token_hash",
    ].some((s) => wire.includes(s)),
    "no code, token or hash on the wire",
  );
  check(
    final.game.lastCombat === null && !wire.includes("combatSeq"),
    "lastCombat cleared at the turn change, combatSeq stays internal",
  );
  check(anna.errors.length === 0 && ben.errors.length === 0, "no server errors during the round");
  return { roomId, created, joined, anna, ben, names };
}
