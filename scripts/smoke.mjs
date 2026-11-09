// End-to-end smoke test: build, start the production server on a random port, play one full round
// with two WebSocket clients, print the result, stop the server. Plain Node, no shell features.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import Database from "better-sqlite3";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = join(root, ".smoke-tmp", randomBytes(4).toString("hex"));
const createCode = randomBytes(12).toString("hex");
let server;
let failed = false;

const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed = true;
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Adjacency for picking a legal target (map data only, from the built engine package).
const { getMap } = await import(
  new URL("../packages/engine/dist/map-data.js", import.meta.url).href
).catch(() => ({ getMap: undefined }));

class Client {
  constructor(name, url) {
    this.name = name;
    this.views = [];
    this.raw = [];
    this.errors = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`${name}: websocket error`));
    });
    this.closeCode = undefined;
    this.ws.onclose = (ev) => {
      this.closeCode = ev.code;
    };
    this.ws.onmessage = (ev) => {
      this.raw.push(String(ev.data));
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "snapshot") this.views.push(msg.view);
      else this.errors.push(msg);
    };
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  get view() {
    return this.views.at(-1);
  }
  async until(pred, label) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (this.view && pred(this.view)) return this.view;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`${this.name}: timeout waiting for ${label}`);
  }
}

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

async function startServer(port, base, extraEnv = {}) {
  const env = { ...process.env };
  delete env.WAGNIS_PUBLIC_URL; // only what the section sets
  server = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: root,
    env: {
      ...env,
      ...extraEnv,
      PORT: String(port),
      WAGNIS_CREATE_CODE: createCode,
      WAGNIS_DB_PATH: join(tmp, "smoke.db"),
    },
    stdio: "ignore",
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 100) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function stopServer() {
  const s = server;
  server = undefined;
  s.kill("SIGTERM");
  await new Promise((resolve) => {
    s.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  s.kill("SIGKILL");
}

/**
 * Trade section: the card draw is random in a live game, so the stand is prepared for determinism: stop the
 * server, give the active player five cards in the saved state (3 x infantry, cavalry, joker; this also
 * covers the restart), start the server again and play the forced trade over WebSocket.
 */
async function tradeSection({ port, base, roomId, tokens, old, names }) {
  console.log("== trade: stop server, prepare a hand of 5 for the active player, restart");
  old.anna.ws.close();
  old.ben.ws.close();
  await stopServer();
  const db = new Database(join(tmp, "smoke.db"));
  const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId);
  const state = JSON.parse(row.state_json);
  const terr = getMap("testland").territories;
  const prepared = [0, 3, 6, 1].map((i) => `card-${terr[i].id}`).concat("card-joker-1");
  const activeId = state.activePlayerId;
  const otherId = state.playerOrder.find((id) => id !== activeId);
  const { secret } = state;
  const drop = (ids) => ids.filter((id) => !prepared.includes(id));
  secret.deck = drop(secret.deck);
  secret.discard = drop(secret.discard);
  for (const id of state.playerOrder) secret.hand[id] = drop(secret.hand[id] ?? []);
  secret.hand[activeId] = [...secret.hand[activeId], ...prepared];
  const handSize = secret.hand[activeId].length;
  // Missions must not end the game by accident in the sections below: the hardest mission for the active player.
  const unreachable = {
    type: "conquerContinents",
    continentIds: ["nordreich"],
    extraContinents: 1,
  };
  secret.mission[activeId] = unreachable;
  secret.originalMission[activeId] = unreachable;
  secret.missionReplaced[activeId] = false;
  const prep = prepareNeutralAttack(state, activeId, otherId);
  db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
  db.close();
  await startServer(port, base);

  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const anna = new Client("Anna", wsUrl);
  const ben = new Client("Ben", wsUrl);
  await Promise.all([anna.ready, ben.ready]);
  anna.send({ type: "hello", roomId, token: tokens.anna });
  ben.send({ type: "hello", roomId, token: tokens.ben });
  const byId = { [tokens.annaId]: anna, [tokens.benId]: ben };
  const owner = byId[activeId];
  const observer = byId[otherId];
  await Promise.all([
    owner.until((v) => v.game?.secret.hand.length === handSize, "restored hand"),
    observer.until((v) => v.game?.handCounts[activeId] === handSize, "restored count"),
  ]);
  check(true, `server restarted, ${names[activeId]} has ${handSize} cards`);
  const mine = owner.view.game;
  check(
    mine.secret.hand.every(
      (c) =>
        c.bonusEligible ===
        (c.territoryId !== null && mine.territories[c.territoryId]?.ownerId === activeId),
    ),
    "bonusEligible on every own card: true exactly for cards of own territories (joker false)",
  );
  check(
    observer.view.game.secret.hand.every((c) => typeof c.bonusEligible === "boolean"),
    "bonusEligible is part of the hand schema for the other player too (their own hand only)",
  );
  check(mine.secret.mustTrade === true, "mustTrade is set for the owner with 5+ cards");
  check(
    observer.view.game.secret.mustTrade === false &&
      !observer.view.game.secret.hand.some((c) => prepared.includes(c.id)),
    "the other player sees none of the prepared cards and no mustTrade",
  );
  check(
    mine.secret.suggestedSets.length >= 1 &&
      mine.secret.suggestedSets.length <= 4 &&
      mine.secret.suggestedSets.every((x, i, a) => i === 0 || a[i - 1].value > x.value),
    `suggestedSets: ${mine.secret.suggestedSets.map((x) => x.value).join(", ")} (at most 4, descending)`,
  );

  // forced trade blocks placing and ending the phase
  const target = Object.entries(mine.territories).find(([, t]) => t.ownerId === activeId)[0];
  const errorsBefore = owner.errors.length;
  owner.send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
  owner.send({ type: "action", action: { type: "endPhase" } });
  await until(() => owner.errors.length >= errorsBefore + 2, "two MUST_TRADE answers");
  check(
    owner.errors.slice(errorsBefore).every((e) => e.code === "MUST_TRADE"),
    "placeArmies and endPhase are answered with MUST_TRADE",
  );
  owner.send({
    type: "action",
    action: { type: "tradeCards", cardIds: [prepared[0], prepared[1], prepared[2]].slice(0, 2) },
  });
  await until(() => owner.errors.length >= errorsBefore + 3, "BAD_MESSAGE for two cards");
  check(owner.errors.at(-1).code === "BAD_MESSAGE", "a trade with two card ids is rejected");

  // trade the best suggestion
  const best = mine.secret.suggestedSets[0];
  const left = mine.reinforcementsLeft;
  const version = owner.view.version;
  owner.send({
    type: "action",
    action: {
      type: "tradeCards",
      cardIds: best.cardIds,
      ...(best.bonusTerritoryId ? { bonusTerritoryId: best.bonusTerritoryId } : {}),
    },
  });
  const [vo, vb] = await Promise.all([
    owner.until((v) => v.game.lastTrade !== null, "trade seen by owner"),
    observer.until((v) => v.game.lastTrade !== null, "trade seen by the other player"),
  ]);
  const tr = vo.game.lastTrade;
  check(
    JSON.stringify(tr) === JSON.stringify(vb.game.lastTrade) && tr.armies === best.value,
    `both players see the trade (seq ${tr.seq}, ${tr.armies} armies, ${tr.cards.length} cards)`,
  );
  check(
    vo.game.reinforcementsLeft === left + best.value && vo.version === version + 1,
    `reinforcements ${left} -> ${vo.game.reinforcementsLeft}, one version bump`,
  );
  check(
    vo.game.secret.hand.length === handSize - 3 &&
      vb.game.handCounts[activeId] === handSize - 3 &&
      vo.game.discardCount === vb.game.discardCount,
    `hand ${handSize} -> ${vo.game.secret.hand.length}, discard pile ${vo.game.discardCount} (public count)`,
  );
  // cards of the other hand and the pile never reach the other player: only the traded ones are public
  const publicIds = new Set(tr.cards.map((c) => c.id));
  const leaked = vo.game.secret.hand
    .map((c) => c.id)
    .filter((id) => observer.raw.join("\n").includes(id));
  check(
    leaked.length === 0 && [...publicIds].every((id) => mine.secret.hand.some((c) => c.id === id)),
    "cards kept in hand never appeared on the other player's connection; only the traded ones are public",
  );
  // placing works again with the traded armies
  owner.send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
  await owner.until(
    (v) => v.game.reinforcementsLeft === vo.game.reinforcementsLeft - 1,
    "placing again",
  );
  check(true, "placing works again after the trade");

  const wire = [...anna.raw, ...ben.raw].join("\n");
  check(
    ![createCode, tokens.anna, tokens.ben, "tokenHash", "token_hash", "tradeSeq", '"deck"'].some(
      (x) => wire.includes(x),
    ),
    "no code, token, tradeSeq or deck on the wire after the restart",
  );
  const unexpected = [...anna.errors, ...ben.errors].filter(
    (e) => e.code !== "MUST_TRADE" && e.code !== "BAD_MESSAGE",
  );
  check(unexpected.length === 0, "no unexpected server errors in the trade section");
  await neutralSection({ owner, observer, activeId, prep });
  check(
    [...anna.errors, ...ben.errors].every(
      (e) => e.code === "MUST_TRADE" || e.code === "BAD_MESSAGE",
    ),
    "no unexpected server errors in the neutral section",
  );
  anna.ws.close();
  ben.ws.close();
}

/**
 * Prepares (in the saved state) a territory of the active player next to a neutral territory with 5+ armies.
 * Never takes the other player's last territory.
 */
function prepareNeutralAttack(state, activeId, otherId) {
  const map = getMap("testland");
  const ids = Object.keys(state.territories);
  const ownedBy = (id) => ids.filter((t) => state.territories[t].ownerId === id);
  let to = ids.find((t) => state.territories[t].ownerId === null);
  if (!to) {
    const give = ownedBy(otherId);
    if (give.length < 2) throw new Error("no neutral territory left to attack");
    to = give[0];
    state.territories[to].ownerId = null;
  }
  const neighbors = map.territories.find((x) => x.id === to).neighbors;
  const from =
    neighbors.find((n) => state.territories[n].ownerId === activeId) ??
    neighbors.find((n) => state.territories[n].ownerId === otherId && ownedBy(otherId).length > 1);
  if (!from) throw new Error("no territory next to the neutral one to attack from");
  state.territories[from].ownerId = activeId;
  state.territories[from].armies = Math.max(state.territories[from].armies, 5);
  return { from, to };
}

/** Attack on a neutral territory: the neutral defender is `null` and defends with maximum dice. */
async function neutralSection({ owner, observer, activeId, prep }) {
  console.log("== neutral: the active player attacks a neutral territory");
  const left = owner.view.game.reinforcementsLeft;
  if (left > 0) {
    owner.send({
      type: "action",
      action: { type: "placeArmies", territoryId: prep.from, count: left },
    });
    await owner.until((v) => v.game.reinforcementsLeft === 0, "placing everything");
  }
  owner.send({ type: "action", action: { type: "endPhase" } });
  await owner.until((v) => v.game.phase === "attack", "attack phase");
  const before = owner.view.game;
  const target = before.territories[prep.to];
  const neutralBefore = Object.values(before.territories).filter((t) => t.ownerId === null).length;
  check(target.ownerId === null, `${prep.to} is neutral before the attack`);
  const seq = before.lastCombat?.seq ?? 0;
  owner.send({
    type: "action",
    action: {
      type: "attack",
      from: prep.from,
      to: prep.to,
      dice: before.territories[prep.from].maxAttackDice,
    },
  });
  const [vo, vb] = await Promise.all([
    owner.until((v) => (v.game.lastCombat?.seq ?? 0) > seq, "combat seen by the owner"),
    observer.until((v) => (v.game.lastCombat?.seq ?? 0) > seq, "combat seen by the other player"),
  ]);
  const c = vo.game.lastCombat;
  check(
    c.defenderId === null && c.attackerId === activeId,
    "combat record: defenderId is null (Neutral), attacker is the active player",
  );
  check(
    JSON.stringify(c) === JSON.stringify(vb.game.lastCombat),
    "both players see the same neutral combat",
  );
  check(
    c.rolls[0].defenderDice.length === Math.min(2, target.armies),
    `Neutral defends with the maximum dice (${c.rolls[0].defenderDice.length} for ${target.armies} armies)`,
  );
  if (vo.game.pendingOccupation) {
    owner.send({
      type: "action",
      action: { type: "occupy", count: vo.game.pendingOccupation.max },
    });
    await owner.until((v) => v.game.pendingOccupation === null, "occupy");
  }
  const after = owner.view.game;
  const neutralAfter = Object.values(after.territories).filter((t) => t.ownerId === null).length;
  check(
    neutralAfter === neutralBefore - (c.summary.conquered ? 1 : 0) &&
      after.conqueredThisTurn === (c.summary.conquered || before.conqueredThisTurn) &&
      after.winnerId === null &&
      Object.keys(after.handCounts).length === 2,
    `conquering Neutral (${c.summary.conquered ? "yes" : "no"}): Neutral only loses territories; no winner, no neutral hand`,
  );
}

/**
 * World map ("welt") with 6 and with 2 players: 42 territories, start distribution, 44 cards, own mission only,
 * the size of one snapshot, then an attack over a sea route (Hudsonland -> Grönland) on a prepared state.
 */
async function weltSection({ port, base, post }) {
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const wm = getMap("welt");
  for (const n of [6, 2]) {
    console.log(`== welt: ${n} players on the world map`);
    // The first room leaves out `mapId`: the server's default is the world map.
    const created = await post("/api/rooms", {
      createCode,
      hostName: "P1",
      ...(n === 6 ? {} : { mapId: "welt" }),
    });
    const roomId = created.body.roomId;
    const people = [{ name: "P1", ...created.body }];
    for (let i = 2; i <= n; i++) {
      const j = await post(`/api/rooms/${roomId}/join`, { name: `P${i}` });
      people.push({ name: `P${i}`, ...j.body });
    }
    const connect = async () => {
      const clients = people.map((p) => new Client(p.name, wsUrl));
      await Promise.all(clients.map((c) => c.ready));
      clients.forEach((c, i) => c.send({ type: "hello", roomId, token: people[i].playerToken }));
      return clients;
    };
    let clients = await connect();
    // Every client checks its own lobby view below, so each one waits for its own snapshot.
    await Promise.all(clients.map((c) => c.until((v) => v.players.length === n, "all joined")));
    check(
      created.status === 201 && clients.every((c) => c.view.mapId === "welt"),
      `room on the world map (mapId in the lobby view: ${clients[0].view.mapId})`,
    );
    clients[0].send({ type: "start" });
    await Promise.all(clients.map((c) => c.until((v) => v.status === "playing", "start")));

    const g = clients[0].view.game;
    const owners = {};
    const armies = {};
    for (const t of Object.values(g.territories)) {
      const k = String(t.ownerId);
      owners[k] = (owners[k] ?? 0) + 1;
      armies[k] = (armies[k] ?? 0) + t.armies;
    }
    const counts = Object.values(owners);
    const expectedArmies = { 2: 40, 6: 20 }[n];
    check(
      Object.keys(g.territories).length === 42 &&
        g.mapId === "welt" &&
        counts.reduce((a, b) => a + b, 0) === 42 &&
        counts.length === (n === 2 ? 3 : n) &&
        Math.max(...counts) - Math.min(...counts) <= 1 &&
        (n !== 2 || owners["null"] === 14),
      `${n} players: 42 territories, split ${counts.join("/")}${n === 2 ? " (third owner Neutral)" : ""}`,
    );
    check(
      Object.values(armies).every((a) => a === expectedArmies) &&
        Object.values(g.territories).every((t) => t.armies >= 1),
      `${n} players: every owner has ${expectedArmies} armies, no territory empty`,
    );
    check(
      g.deckCount === 44 &&
        g.discardCount === 0 &&
        Object.values(g.handCounts).every((c) => c === 0),
      "44 cards (42 territories + 2 jokers) in the deck at the start",
    );
    // No mission is dealt twice, but whoever draws the elimination mission against themselves holds the map's
    // fallback instead (rules.md 1.1). With two such draws, two players hold the same fallback.
    const secrets = clients.map((c) => c.view.game.secret);
    const missions = secrets.map((s) => s.mission);
    const drawn = secrets.filter((s) => !s.missionReplaced).map((s) => JSON.stringify(s.mission));
    const replaced = secrets.filter((s) => s.missionReplaced).map((s) => JSON.stringify(s.mission));
    check(
      missions.every((m) => m !== null) &&
        new Set(drawn).size === drawn.length &&
        new Set(replaced).size <= 1 &&
        !drawn.some((m) => replaced.includes(m)) &&
        clients.every((c, i) =>
          missions.every(
            (m, j) =>
              j === i ||
              JSON.stringify(m) === JSON.stringify(missions[i]) ||
              !c.raw.join("\n").includes(JSON.stringify(m)),
          ),
        ),
      `${n} players: no mission dealt twice (${replaced.length} self-target draw(s) hold the fallback), none sees another player's`,
    );
    const wire = clients.map((c) => c.raw.join("\n")).join("\n");
    check(
      !wire.includes("originalMission") && !wire.includes("stateVersion"),
      "no originalMission and no stateVersion on the wire",
    );
    const bytes = Math.max(...clients.map((c) => Buffer.byteLength(c.raw.at(-1))));
    console.log(
      `   snapshot size with ${n} players: ${bytes} bytes (largest of the last messages)`,
    );
    check(bytes < 32768, `a snapshot stays under 32 KB (${bytes} bytes)`);

    // Prepared state: the active player holds Hudsonland with 30 armies, Grönland is a foreign territory with 1.
    clients.forEach((c) => c.ws.close());
    await stopServer();
    const db = new Database(join(tmp, "smoke.db"));
    const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId);
    const state = JSON.parse(row.state_json);
    const active = state.activePlayerId;
    const other = state.playerOrder.find((id) => id !== active);
    state.territories.hudsonland = { ownerId: active, armies: 30 };
    state.territories.groenland = { ownerId: other, armies: 1 };
    db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
    db.close();
    await startServer(port, base);
    clients = await connect();
    await Promise.all(clients.map((c) => c.until((v) => v.game?.turn === 1, "restored")));
    const ownerClient = clients[people.findIndex((p) => p.playerId === active)];
    const seaRoute = wm.territories
      .find((t) => t.id === "hudsonland")
      .neighbors.includes("groenland");
    check(seaRoute, "Hudsonland and Grönland are neighbours in the engine data (a sea route)");
    for (let left = ownerClient.view.game.reinforcementsLeft; left > 0; left--) {
      const before = ownerClient.view.game.territories.hudsonland.armies;
      ownerClient.send({
        type: "action",
        action: { type: "placeArmies", territoryId: "hudsonland", count: 1 },
      });
      await ownerClient.until((v) => v.game.territories.hudsonland.armies === before + 1, "place");
    }
    ownerClient.send({ type: "action", action: { type: "endPhase" } });
    await ownerClient.until((v) => v.game.phase === "attack", "attack phase");
    ownerClient.send({
      type: "action",
      action: { type: "blitz", from: "hudsonland", to: "groenland" },
    });
    await ownerClient.until((v) => v.game.lastCombat !== null, "sea attack result");
    const lc = ownerClient.view.game.lastCombat;
    check(
      lc.from === "hudsonland" && lc.to === "groenland" && lc.summary.conquered === true,
      "attack over the sea route Hudsonland -> Grönland: accepted, conquered",
    );
    const pending = ownerClient.view.game.pendingOccupation;
    if (pending) {
      ownerClient.send({ type: "action", action: { type: "occupy", count: pending.max } });
    }
    await ownerClient.until(
      (v) => v.game.pendingOccupation === null && v.game.territories.groenland.ownerId === active,
      "occupation",
    );
    const watcher = clients.find((c) => c !== ownerClient);
    await watcher.until((v) => v.game.territories.groenland.ownerId === active, "watcher sees it");
    check(true, "the conquest reached every player");
    check(
      clients.every((c) => c.errors.length === 0),
      `${n} players: no server errors`,
    );
    clients.forEach((c) => c.ws.close());
  }
}

/**
 * "Two missions, keep one" with three players (plan 013): each sees only the own two offers, the choice runs at the
 * same time on three connections, survives a server restart in the middle, and the first turn starts after the last choice.
 */
async function draftSection({ port, base, post }) {
  console.log("== mission draft: three players choose one of two missions each");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const created = await post("/api/rooms", { createCode, hostName: "Gerd", mapId: "testland" });
  const roomId = created.body.roomId;
  const hanna = await post(`/api/rooms/${roomId}/join`, { name: "Hanna" });
  const ingo = await post(`/api/rooms/${roomId}/join`, { name: "Ingo" });
  const people = [
    { name: "Gerd", ...created.body },
    { name: "Hanna", ...hanna.body },
    { name: "Ingo", ...ingo.body },
  ];
  const connect = async () => {
    const clients = people.map((p) => new Client(p.name, wsUrl));
    await Promise.all(clients.map((c) => c.ready));
    clients.forEach((c, i) => c.send({ type: "hello", roomId, token: people[i].playerToken }));
    return clients;
  };
  let clients = await connect();
  await Promise.all(clients.map((c) => c.until((v) => v.players.length === 3, "all joined")));
  clients[1].send({ type: "settings", missionDraft: true });
  await until(() => clients[1].errors.length > 0, "NOT_HOST");
  check(
    clients[1].errors.at(-1)?.code === "NOT_HOST",
    "a guest cannot switch the draft on (NOT_HOST)",
  );
  clients[0].send({ type: "settings", missionDraft: true, holdToWin: true });
  await Promise.all(
    clients.map((c) => c.until((v) => v.missionDraft && v.holdToWin, "options on")),
  );
  check(true, "the host switched both mission options on; every player sees them");
  clients[0].send({ type: "start" });
  await Promise.all(clients.map((c) => c.until((v) => v.status === "playing", "start")));
  const offers = clients.map((c) => c.view.game.secret.missionOffer);
  check(
    offers.every((o) => Array.isArray(o) && o.length === 2) &&
      clients.every(
        (c) => c.view.game.phase === "missionChoice" && c.view.game.secret.mission === null,
      ),
    "everybody has two offers and no mission yet; the phase is missionChoice",
  );
  const foreign = clients.every((c, i) =>
    offers.every(
      (o, j) =>
        j === i ||
        o.every(
          (m) =>
            offers[i].some((own) => JSON.stringify(own) === JSON.stringify(m)) ||
            !c.raw.join("\n").includes(JSON.stringify(m)),
        ),
    ),
  );
  check(foreign, "no connection carries another player's offer");
  let wire = clients.flatMap((c) => c.raw).join("\n");
  check(
    !wire.includes("missionOfferDealt") &&
      !wire.includes("discardedMission") &&
      !wire.includes("stateVersion"),
    "no internal draft field on the wire",
  );

  // two choose at once, then the server restarts before the third
  clients[0].send({ type: "action", action: { type: "chooseMission", index: 0 } });
  clients[1].send({ type: "action", action: { type: "chooseMission", index: 1 } });
  await Promise.all(
    clients.map((c) => c.until((v) => v.game.missionChoice?.chosen.length === 2, "two chosen")),
  );
  check(
    clients.every((c) => c.view.game.phase === "missionChoice"),
    "after two of three choices the game still waits",
  );
  clients.forEach((c) => c.ws.close());
  await stopServer();
  await startServer(port, base);
  clients = await connect();
  await Promise.all(
    clients.map((c) =>
      c.until((v) => v.game?.missionChoice?.chosen.length === 2, "restored choice"),
    ),
  );
  check(
    JSON.stringify(clients[2].view.game.secret.missionOffer) === JSON.stringify(offers[2]) &&
      clients[0].view.game.secret.missionOffer === null,
    "after the restart the open offer is still there for the third player and gone for the others",
  );
  clients[2].send({ type: "action", action: { type: "chooseMission", index: 0 } });
  await Promise.all(clients.map((c) => c.until((v) => v.game.phase === "reinforce", "first turn")));
  check(
    clients.every((c) => c.view.game.turn === 1 && c.view.game.missionChoice === null) &&
      JSON.stringify(clients[0].view.game.secret.mission) === JSON.stringify(offers[0][0]) &&
      JSON.stringify(clients[1].view.game.secret.mission) === JSON.stringify(offers[1][1]) &&
      JSON.stringify(clients[2].view.game.secret.mission) === JSON.stringify(offers[2][0]),
    "the last choice starts the first turn; each player holds the chosen mission",
  );
  wire = clients.flatMap((c) => c.raw).join("\n");
  check(
    !wire.includes('"discarded":{') && clients.every((c) => c.errors.length === 0),
    "no discarded mission before the end, no server errors",
  );
  clients.forEach((c) => c.ws.close());
}

/**
 * Missions with three players: each sees only the own mission; then a prepared state (one winner by mission, one
 * replaced mission, one self-target draw) shows the resolution to everybody, also after a restart.
 */
async function missionSection({ port, base, post }) {
  console.log("== missions: three players, own mission only, then the resolution after the game");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const created = await post("/api/rooms", { createCode, hostName: "Dora", mapId: "testland" });
  const roomId = created.body.roomId;
  const emil = await post(`/api/rooms/${roomId}/join`, { name: "Emil" });
  const fritz = await post(`/api/rooms/${roomId}/join`, { name: "Fritz" });
  check(
    created.status === 201 && emil.status === 200 && fritz.status === 200,
    "three players in a new room",
  );
  const people = [
    { name: "Dora", ...created.body },
    { name: "Emil", ...emil.body },
    { name: "Fritz", ...fritz.body },
  ];
  const connect = async () => {
    const clients = people.map((p) => new Client(p.name, wsUrl));
    await Promise.all(clients.map((c) => c.ready));
    clients.forEach((c, i) => c.send({ type: "hello", roomId, token: people[i].playerToken }));
    return clients;
  };

  let clients = await connect();
  clients[0].send({ type: "start" });
  await Promise.all(clients.map((c) => c.until((v) => v.status === "playing", "start")));
  const missions = clients.map((c) => c.view.game.secret.mission);
  check(
    missions.every((m) => m !== null) &&
      clients.every((c) => c.view.game.victoryMode === "missions" && c.view.game.missions === null),
    "every player has a mission; no resolution while the game runs",
  );
  const foreign = clients.every((c, i) =>
    missions.every(
      (m, j) =>
        j === i ||
        JSON.stringify(m) === JSON.stringify(missions[i]) ||
        !c.raw.join("\n").includes(JSON.stringify(m)),
    ),
  );
  check(foreign, "no player's connection carries another player's mission");
  let wire = clients.flatMap((c) => c.raw).join("\n");
  check(
    !wire.includes("originalMission") && !wire.includes("stateVersion"),
    "no originalMission and no stateVersion on the wire while the game runs",
  );

  // prepared state: winner by mission (A), replaced mission (B), self-target draw (C)
  clients.forEach((c) => c.ws.close());
  await stopServer();
  const db = new Database(join(tmp, "smoke.db"));
  const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId);
  const state = JSON.parse(row.state_json);
  const [a, b, c] = [
    state.activePlayerId,
    ...state.playerOrder.filter((id) => id !== state.activePlayerId),
  ];
  const fallback = { type: "holdTerritories", count: 6, minArmies: 2 };
  const easy = { type: "holdTerritories", count: 1, minArmies: 1 };
  const { secret } = state;
  secret.mission = { [a]: easy, [b]: fallback, [c]: fallback };
  secret.originalMission = {
    [a]: easy,
    [b]: { type: "eliminatePlayer", targetPlayerId: c },
    [c]: { type: "eliminatePlayer", targetPlayerId: c },
  };
  secret.missionReplaced = { [a]: false, [b]: true, [c]: true };
  db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
  db.close();
  await startServer(port, base);

  clients = await connect();
  const byId = Object.fromEntries(people.map((p, i) => [p.playerId, clients[i]]));
  await Promise.all(clients.map((x) => x.until((v) => v.game?.turn === 1, "restored game")));
  check(
    JSON.stringify(byId[a].view.game.secret.mission) === JSON.stringify(easy) &&
      byId[a].view.game.secret.missionReplaced === false &&
      JSON.stringify(byId[b].view.game.secret.mission) === JSON.stringify(fallback) &&
      byId[b].view.game.secret.missionReplaced === true &&
      byId[c].view.game.secret.missionReplaced === true,
    "after the restart each player sees the own (replacement) mission and its flag",
  );
  wire = clients.flatMap((x) => x.raw).join("\n");
  check(
    !wire.includes("eliminatePlayer") && !wire.includes("originalMission"),
    "the replaced and self-target missions never show before the end, not even to the owner",
  );
  check(
    !byId[a].raw.join("\n").includes('"missionReplaced":true') &&
      byId[a].view.game.missions === null,
    "the winner-to-be sees no sign of the others' replacements",
  );

  // A wins by placing an army (mission checked after every action of the active player)
  const target = Object.entries(byId[a].view.game.territories).find(([, t]) => t.ownerId === a)[0];
  byId[a].send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
  await Promise.all(clients.map((x) => x.until((v) => v.game.winnerId === a, "win by mission")));
  const g = byId[a].view.game;
  check(
    clients.every((x) => x.view.game.winReason === "mission" && x.view.status === "finished"),
    "winReason is mission, room status finished, for everybody",
  );
  const same = clients.every(
    (x) => JSON.stringify(x.view.game.missions) === JSON.stringify(g.missions),
  );
  check(
    same &&
      Object.keys(g.missions).length === 3 &&
      g.missions[a].originalMission === null &&
      JSON.stringify(g.missions[b].mission) === JSON.stringify(fallback) &&
      g.missions[b].originalMission?.targetPlayerId === c &&
      g.missions[c].originalMission?.type === "eliminatePlayer" &&
      g.missions[c].originalMission?.targetPlayerId === c,
    "resolution for all: current missions, original only where replaced, self-target visible as original",
  );
  byId[b].send({ type: "action", action: { type: "endPhase" } });
  await until(() => byId[b].errors.length > 0, "GAME_OVER");
  check(byId[b].errors.at(-1).code === "NOT_IN_GAME", "no action after the end (NOT_IN_GAME)");

  // the resolution survives a restart and shows on hello
  clients.forEach((x) => x.ws.close());
  await stopServer();
  await startServer(port, base);
  clients = await connect();
  await Promise.all(
    clients.map((x) => x.until((v) => v.game?.winnerId === a, "hello after the end")),
  );
  check(
    clients.every((x) => JSON.stringify(x.view.game.missions) === JSON.stringify(g.missions)) &&
      clients.every((x) => x.view.game.winReason === "mission"),
    "after a restart the resolution is the same for everybody (hello after the end)",
  );
  wire = clients.flatMap((x) => x.raw).join("\n");
  check(
    ![createCode, ...people.map((p) => p.playerToken), "tokenHash", "stateVersion"].some((x) =>
      wire.includes(x),
    ),
    "no code, token or stateVersion on the wire in the mission section",
  );
  clients.forEach((x) => x.ws.close());
}

/**
 * Host functions (plan 007): lobby choice, removal in the lobby (4004, token worthless), skipping, host handover (only to
 * a connected player), removal in a running game (4004, marks for everybody), a win by removal, back to the lobby
 * (game number 2, players stay) and a second game. Everything over the real HTTP and WebSocket interfaces.
 */
/** WAGNIS_PUBLIC_URL (plan 008): the address is in the lobby snapshot only, `null` in the game and without the variable. */
async function publicUrlSection({ port, base, post }) {
  console.log("== public url: lobby snapshot only");
  const address = "http://example.test:3000";
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  await stopServer();
  await startServer(port, base, { WAGNIS_PUBLIC_URL: `${address}/` });
  const created = await post("/api/rooms", { createCode, hostName: "Lena", mapId: "testland" });
  const joined = await post(`/api/rooms/${created.body.roomId}/join`, { name: "Max" });
  const roomId = created.body.roomId;
  const lena = new Client("Lena", wsUrl);
  const max = new Client("Max", wsUrl);
  await Promise.all([lena.ready, max.ready]);
  lena.send({ type: "hello", roomId, token: created.body.playerToken });
  max.send({ type: "hello", roomId, token: joined.body.playerToken });
  await Promise.all([
    lena.until((v) => v.players.length === 2, "lobby"),
    max.until((v) => v.players.length === 2, "lobby"),
  ]);
  check(
    lena.view.publicUrl === address && max.view.publicUrl === address,
    "lobby snapshot carries the normalised public address for both players",
  );
  lena.send({ type: "start" });
  await Promise.all([
    lena.until((v) => v.status === "playing", "start"),
    max.until((v) => v.status === "playing", "start"),
  ]);
  check(
    lena.view.publicUrl === null && max.view.publicUrl === null,
    "snapshot in the game has publicUrl null",
  );
  const wire = [...lena.raw, ...max.raw].join("\n");
  check(
    ![created.body.playerToken, joined.body.playerToken, createCode, "tokenHash"].some((x) =>
      wire.includes(x),
    ),
    "no token, code or hash next to the public address",
  );
  lena.ws.close();
  max.ws.close();
  await stopServer();
  await startServer(port, base);
  const plain = await post("/api/rooms", { createCode, hostName: "Nora", mapId: "testland" });
  const nora = new Client("Nora", wsUrl);
  await nora.ready;
  nora.send({ type: "hello", roomId: plain.body.roomId, token: plain.body.playerToken });
  await nora.until((v) => v.status === "lobby", "lobby without the variable");
  check(nora.view.publicUrl === null, "without WAGNIS_PUBLIC_URL the lobby has publicUrl null");
  nora.ws.close();
}

async function hostSection({ port, base, post }) {
  console.log("== host: lobby choice, removal, skipping, handover, back to the lobby");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const names = ["Hanna", "Ida", "Jan", "Kai"];
  const created = await post("/api/rooms", { createCode, hostName: names[0], mapId: "testland" });
  const roomId = created.body.roomId;
  const people = [{ name: names[0], ...created.body }];
  for (const name of names.slice(1)) {
    const j = await post(`/api/rooms/${roomId}/join`, { name });
    people.push({ name, ...j.body });
  }
  const connect = async (p) => {
    const c = new Client(p.name, wsUrl);
    await c.ready;
    c.send({ type: "hello", roomId, token: p.playerToken });
    return c;
  };
  const [hanna, ida, jan, kai] = await Promise.all(people.map(connect));
  const all = [hanna, ida, jan, kai];
  await Promise.all(
    all.map((c) => c.until((v) => v.players.length === 4, "everybody in the lobby")),
  );
  check(
    hanna.view.victoryMode === "missions" && hanna.view.gameNo === 1,
    "the lobby starts with the mode missions and game number 1",
  );

  // lobby choice
  const v0 = hanna.view.version;
  hanna.send({ type: "settings", victoryMode: "domination" });
  await Promise.all(all.map((c) => c.until((v) => v.victoryMode === "domination", "mode")));
  check(
    all.every((c) => c.view.version === v0 + 1),
    "the host's choice reaches everybody with one version step",
  );
  ida.send({ type: "settings", victoryMode: "missions" });
  await until(() => ida.errors.length > 0, "NOT_HOST");
  check(ida.errors.at(-1).code === "NOT_HOST", "a guest cannot change the lobby choice (NOT_HOST)");
  hanna.send({ type: "settings", victoryMode: "missions" });
  await Promise.all(all.map((c) => c.until((v) => v.victoryMode === "missions", "mode back")));

  // removal in the lobby: Kai
  const kaiRaw = kai.raw.length;
  hanna.send({ type: "host", action: { type: "removePlayer", playerId: people[3].playerId } });
  await Promise.all(
    [hanna, ida, jan].map((c) => c.until((v) => v.players.length === 3, "Kai removed")),
  );
  await until(() => kai.closeCode !== undefined, "Kai's connection ends");
  check(kai.closeCode === 4004, "the removed lobby player's connection ends with 4004");
  check(kai.raw.length === kaiRaw, "the removed player gets no further snapshot");
  const kaiAgain = new Client("Kai again", wsUrl);
  await kaiAgain.ready;
  kaiAgain.send({ type: "hello", roomId, token: people[3].playerToken });
  await until(() => kaiAgain.closeCode !== undefined, "hello refused");
  check(
    kaiAgain.closeCode === 4001 && kaiAgain.errors[0]?.code === "NOT_AUTHENTICATED",
    "the removed player's token is worthless (hello: NOT_AUTHENTICATED, 4001)",
  );

  // start with three players
  hanna.send({ type: "start" });
  await Promise.all([hanna, ida, jan].map((c) => c.until((v) => v.status === "playing", "start")));
  const g1 = hanna.view.game;
  check(
    g1.mapId === "testland" && g1.victoryMode === "missions" && hanna.view.gameNo === 1,
    "the game takes the room's map and mode",
  );

  // skipping
  const turn = g1.turn;
  hanna.send({ type: "host", action: { type: "skipTurn", turn } });
  await Promise.all([hanna, ida, jan].map((c) => c.until((v) => v.game.turn === turn + 1, "skip")));
  check(
    [hanna, ida, jan].every((c) => c.view.game.activePlayerId !== g1.activePlayerId),
    "the host's skip passes the turn on for everybody",
  );
  const errs = hanna.errors.length;
  hanna.send({ type: "host", action: { type: "skipTurn", turn } });
  await until(() => hanna.errors.length > errs, "STALE_TURN");
  check(hanna.errors.at(-1).code === "STALE_TURN", "skipping the same turn twice is STALE_TURN");

  // handover: not to a player without a connection, then to Ida
  jan.ws.close();
  await Promise.all(
    [hanna, ida].map((c) =>
      c.until((v) => !v.players.find((p) => p.id === people[2].playerId).connected, "Jan away"),
    ),
  );
  const e2 = hanna.errors.length;
  hanna.send({ type: "host", action: { type: "transferHost", playerId: people[2].playerId } });
  await until(() => hanna.errors.length > e2, "NOT_PRESENT");
  check(
    hanna.errors.at(-1).code === "NOT_PRESENT",
    "no handover to a player without a connection (NOT_PRESENT)",
  );
  const jan2 = await connect(people[2]);
  await jan2.until((v) => v.game, "Jan back");
  hanna.send({ type: "host", action: { type: "transferHost", playerId: people[1].playerId } });
  await Promise.all(
    [hanna, ida, jan2].map((c) =>
      c.until((v) => v.players.find((p) => p.id === people[1].playerId).isHost, "handover"),
    ),
  );
  check(
    hanna.view.you.isHost === false &&
      ida.view.you.isHost === true &&
      [hanna, ida, jan2].every((c) => c.view.players.filter((p) => p.isHost).length === 1),
    "the handover moves the role: exactly one host, right you.isHost for everybody",
  );
  const e3 = hanna.errors.length;
  hanna.send({ type: "host", action: { type: "skipTurn", turn: hanna.view.game.turn } });
  await until(() => hanna.errors.length > e3, "NOT_HOST after the handover");
  check(hanna.errors.at(-1).code === "NOT_HOST", "the old host has no host rights any more");

  // the new host removes Jan in the running game
  const janRaw = jan2.raw.length;
  ida.send({ type: "host", action: { type: "removePlayer", playerId: people[2].playerId } });
  await Promise.all(
    [hanna, ida].map((c) => c.until((v) => v.game.removedPlayerIds.length === 1, "Jan removed")),
  );
  await until(() => jan2.closeCode !== undefined, "Jan's connection ends");
  const view = ida.view;
  check(
    jan2.closeCode === 4004 && jan2.raw.length === janRaw,
    "the removed player's connection ends with 4004 and gets no further snapshot",
  );
  check(
    view.players.find((p) => p.id === people[2].playerId).removed === true &&
      !Object.values(view.game.territories).some((t) => t.ownerId === people[2].playerId) &&
      Object.values(view.game.territories).some((t) => t.ownerId === null) &&
      view.game.handCounts[people[2].playerId] === 0,
    "the removed player is marked, his territories are neutral, his hand count is 0",
  );
  const wireOthers = [...hanna.raw, ...ida.raw].join("\n");
  check(
    !wireOthers.includes(people[2].playerToken) && !wireOthers.includes('"discard"'),
    "no token and no discard pile on the others' connections",
  );

  // a win by removal: Ida removes Hanna, Ida is the last player
  ida.send({ type: "host", action: { type: "removePlayer", playerId: people[0].playerId } });
  await ida.until((v) => v.status === "finished", "finished");
  check(
    ida.view.game.winnerId === people[1].playerId && ida.view.game.winReason === "lastPlayer",
    "removing the second-to-last player ends the game (lastPlayer)",
  );
  const e4 = ida.errors.length;
  ida.send({ type: "host", action: { type: "skipTurn", turn: ida.view.game.turn } });
  await until(() => ida.errors.length > e4, "NOT_IN_GAME");
  check(ida.errors.at(-1).code === "NOT_IN_GAME", "no host action after the end (NOT_IN_GAME)");

  // back to the lobby, the removed rows are gone, a new game starts
  const versionEnd = ida.view.version;
  ida.send({ type: "backToLobby" });
  await ida.until((v) => v.status === "lobby", "lobby again");
  check(
    ida.view.gameNo === 2 &&
      ida.view.game === null &&
      ida.view.version === versionEnd + 1 &&
      ida.view.players.length === 1 &&
      ida.view.you.isHost,
    "back to the lobby: game number 2, no game, version keeps counting, removed players gone, the host stays",
  );
  for (const name of ["Hanna", "Jan"]) {
    const j = await post(`/api/rooms/${roomId}/join`, { name });
    check(j.status === 200, `${name} can join again under the freed name`);
  }
  await ida.until((v) => v.players.length === 3, "three again");
  ida.send({ type: "start" });
  await ida.until((v) => v.status === "playing", "second game");
  check(
    ida.view.gameNo === 2 &&
      ida.view.game.turn === 1 &&
      ida.view.game.lastCombat === null &&
      ida.view.game.removedPlayerIds.length === 0,
    "the second game is a fresh one (turn 1, no combat, nobody removed)",
  );
  check(
    [hanna, ida, jan, kai, kaiAgain, jan2].every((c) =>
      c.errors.every((e) => e.code !== "INTERNAL"),
    ),
    "no INTERNAL errors in the host section",
  );
  for (const c of [hanna, ida, jan, kai, kaiAgain, jan2]) c.ws.close();
}

/**
 * Client bundle: no mission list (continent id sequences of the world missions, with quotes stripped, appear nowhere)
 * and no external request (no URL except the namespace and error-message strings of the libraries; HTML and CSS none).
 */
async function fortifySection({ port, base, post }) {
  console.log("== fortify moves per turn: lobby setting 2, two moves, then the turn changes");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const map = getMap("testland");
  for (let attempt = 1; attempt <= 12; attempt++) {
    const created = await post("/api/rooms", { createCode, hostName: "Lena", mapId: "testland" });
    const roomId = created.body.roomId;
    const joined = await post(`/api/rooms/${roomId}/join`, { name: "Mo" });
    const lena = new Client("Lena", wsUrl);
    const mo = new Client("Mo", wsUrl);
    await Promise.all([lena.ready, mo.ready]);
    lena.send({ type: "hello", roomId, token: created.body.playerToken });
    mo.send({ type: "hello", roomId, token: joined.body.playerToken });
    await Promise.all([lena, mo].map((c) => c.until((v) => v.players.length === 2, "joined")));
    if (attempt === 1) {
      check(lena.view.fortifyMoves === 1, "a new room has the setting fortifyMoves 1");
      mo.send({ type: "settings", fortifyMoves: 2 });
      await until(() => mo.errors.length > 0, "NOT_HOST");
      check(mo.errors.at(-1).code === "NOT_HOST", "a guest cannot change fortifyMoves (NOT_HOST)");
    }
    lena.send({ type: "settings", victoryMode: "domination", fortifyMoves: 2 });
    await Promise.all([lena, mo].map((c) => c.until((v) => v.fortifyMoves === 2, "setting 2")));
    lena.send({ type: "start" });
    await Promise.all([lena, mo].map((c) => c.until((v) => v.status === "playing", "start")));
    check(
      lena.view.fortifyMoves === 2 && mo.view.fortifyMoves === 2,
      "the game starts with fortifyMoves 2 for everybody",
    );
    lena.send({ type: "settings", fortifyMoves: 1 });
    await until(() => lena.errors.length > 0, "NOT_IN_LOBBY");
    check(
      lena.errors.at(-1).code === "NOT_IN_LOBBY" && lena.view.fortifyMoves === 2,
      "the setting cannot be changed in a running game (NOT_IN_LOBBY)",
    );

    const byId = { [created.body.playerId]: lena, [joined.body.playerId]: mo };
    const g = lena.view.game;
    const active = byId[g.activePlayerId];
    const own = (v, id) => v.game.territories[id].ownerId === g.activePlayerId;
    const pair = map.territories
      .flatMap((t) => t.neighbors.map((n) => [t.id, n]))
      .find(([a, b]) => own(lena.view, a) && own(lena.view, b));
    if (!pair) {
      lena.ws.close();
      mo.ws.close();
      continue;
    }
    const [from, to] = pair;
    for (let left = g.reinforcementsLeft; left > 0; left--) {
      const before = active.view.game.territories[from].armies;
      active.send({
        type: "action",
        action: { type: "placeArmies", territoryId: from, count: 1 },
      });
      await active.until((v) => v.game.territories[from].armies === before + 1, "placeArmies");
    }
    active.send({ type: "action", action: { type: "endPhase" } });
    await active.until((v) => v.game.phase === "attack", "phase attack");
    active.send({ type: "action", action: { type: "endPhase" } });
    await active.until((v) => v.game.phase === "fortify", "phase fortify");
    check(
      active.view.game.fortify.movesDone === 0 && active.view.game.fortify.movesMax === 2,
      "the fortify view says move 0 of 2",
    );
    const turn = active.view.game.turn;
    const v0 = active.view.version;
    active.send({ type: "action", action: { type: "fortify", from, to, count: 1 } });
    await active.until((v) => v.version === v0 + 1, "first move");
    check(
      active.view.game.activePlayerId === g.activePlayerId &&
        active.view.game.phase === "fortify" &&
        active.view.game.turn === turn &&
        active.view.game.fortify.movesDone === 1,
      "after the first move the player is still in the fortify phase (move 1 of 2)",
    );
    const other = byId[Object.keys(byId).find((id) => id !== g.activePlayerId)];
    await other.until((v) => v.version === v0 + 1, "snapshot for the other player");
    check(other.view.game.fortify === null, "the other player sees no fortify view");
    active.send({ type: "action", action: { type: "fortify", from: to, to: from, count: 1 } });
    await active.until((v) => v.game.turn === turn + 1, "second move ends the turn");
    check(
      active.view.game.activePlayerId !== g.activePlayerId &&
        active.view.game.phase === "reinforce",
      "the second move ends the turn",
    );
    const errs = active.errors.length;
    active.send({ type: "action", action: { type: "fortify", from, to, count: 1 } });
    await until(() => active.errors.length > errs, "NOT_YOUR_TURN");
    check(active.errors.at(-1).code === "NOT_YOUR_TURN", "a third fortify is NOT_YOUR_TURN");
    check(
      ![...lena.raw, ...mo.raw].some((m) => m.includes("fortifyMovesDone")),
      "no fortifyMovesDone on the wire",
    );
    lena.ws.close();
    mo.ws.close();
    return;
  }
  throw new Error("no room with two linked own territories after 12 tries");
}

async function bundleChecks(bundle, assetsDir) {
  const { worldMissions } = await import(
    new URL("../packages/engine/dist/maps/index.js", import.meta.url).href
  );
  const flat = bundle.replace(/["'`\s]/g, "");
  const sequences = worldMissions.missions
    .filter((m) => m.type === "conquerContinents" && m.continentIds.length >= 2)
    .map((m) => m.continentIds.join(","));
  const found = sequences.filter((q) => flat.includes(q));
  check(
    sequences.length >= 8 && found.length === 0,
    `client bundle holds no world mission list (${sequences.length} sequences searched, ${found.length} found)`,
  );

  const allowedHosts = new Set(["www.w3.org", "svelte.dev", "json-schema.org"]);
  const urls = [...bundle.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]);
  const foreign = [...new Set(urls.filter((h) => !allowedHosts.has(h)))];
  const others = readdirSync(assetsDir)
    .filter((f) => !f.endsWith(".js"))
    .map((f) => readFileSync(join(assetsDir, f), "utf8"))
    .concat(readFileSync(join(root, "apps/client/dist/index.html"), "utf8"))
    .join("\n");
  const plain = /https?:\/\/|@import|\/\/fonts\./.test(others);
  check(
    foreign.length === 0 && !plain,
    `client bundle makes no external request (${foreign.join(", ") || "no foreign host"}; HTML/CSS ${plain ? "have URLs" : "have no URLs"})`,
  );
  // The atlas look is drawn without webfonts, imports or SVG filters (plan 006, 6.2); the script bundle may name
  // http(s) only for the namespaces above.
  const inJs = ["fonts.", "@import", "feGaussianBlur", "feDropShadow"].filter((n) =>
    bundle.includes(n),
  );
  check(
    inJs.length === 0,
    `client bundle has no font service, @import or SVG filter (${inJs.join(", ") || "none found"})`,
  );
  const assets = readdirSync(assetsDir).map((f) => readFileSync(join(assetsDir, f)));
  const raw = assets.reduce((n, b) => n + b.length, 0);
  const zipped = assets.reduce((n, b) => n + gzipSync(b).length, 0);
  console.log(
    `info client assets: ${(raw / 1024).toFixed(1)} KB raw, ${(zipped / 1024).toFixed(1)} KB gzip`,
  );
}

async function until(pred, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  console.log("== build");
  const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "pipe", encoding: "utf8" });
  if (build.status !== 0) {
    console.log(build.stdout, build.stderr);
    throw new Error("build failed");
  }
  console.log("ok   npm run build");

  const assetsDir = join(root, "apps/client/dist/assets");
  const bundle = readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assetsDir, f), "utf8"))
    .join("\n");
  const leaked = [
    "applyAction",
    "applyHostAction",
    "checkLastPlayer",
    "replaceTargetMissions",
    "createGame",
    "viewFor",
    "calculateReinforcements",
    "validateMap",
    "tradeValue",
    "cardCatalog",
    "drawCard",
    "missionSatisfied",
    "checkVictory",
    "migrateState",
    "weltRules",
    "worldMissions",
    "startArmies",
    "minReinforcement",
  ].filter((n) => bundle.includes(n));
  check(
    leaked.length === 0,
    `client bundle contains no engine logic or rule values (${leaked.join(", ") || "none found"})`,
  );
  await bundleChecks(bundle, assetsDir);

  const port = await freePort();
  mkdirSync(tmp, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  await startServer(port, base);
  console.log(`== server up on random port ${port} (production mode, node on dist)`);

  const index = await fetch(base + "/");
  check(
    index.ok && (await index.text()).includes("<title>Wagnis</title>"),
    "GET / serves the client",
  );
  check(index.headers.get("x-robots-tag") === "noindex", "X-Robots-Tag: noindex");
  const spa = await fetch(base + "/r/K7M2XQ");
  check(spa.ok && (await spa.text()).includes('id="app"'), "SPA fallback for /r/K7M2XQ");
  check(
    (await fetch(base + "/assets/missing.js")).status === 404,
    "missing asset is 404, not index.html",
  );

  // PWA (plan 010): manifest and icons are reachable, the page links them, and there is no service worker.
  const manifestRes = await fetch(base + "/manifest.webmanifest");
  const manifest = manifestRes.ok ? await manifestRes.json() : { icons: [] };
  const iconRes = await Promise.all(manifest.icons.map((i) => fetch(base + i.src)));
  const indexHtml = await (await fetch(base + "/")).text();
  check(
    manifest.name === "Wagnis" &&
      manifest.icons.length > 0 &&
      iconRes.every((r) => r.ok && r.headers.get("content-type") === "image/png") &&
      indexHtml.includes('rel="manifest" href="/manifest.webmanifest"') &&
      (await fetch(base + "/icons/apple-touch-icon.png")).ok &&
      (await fetch(base + "/sw.js")).status === 404,
    "PWA: manifest and icons reachable, page links them, no service worker",
  );

  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
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

  await tradeSection({
    port,
    base,
    roomId,
    tokens: {
      anna: created.body.playerToken,
      ben: joined.body.playerToken,
      annaId: created.body.playerId,
      benId: joined.body.playerId,
    },
    old: { anna, ben },
    names,
  });
  await missionSection({ port, base, post });
  await draftSection({ port, base, post });
  await weltSection({ port, base, post });
  await hostSection({ port, base, post });
  await fortifySection({ port, base, post });
  await publicUrlSection({ port, base, post });
}

try {
  await main();
} catch (err) {
  failed = true;
  console.log(`FAIL ${err.message}`);
} finally {
  if (server) await stopServer();
  rmSync(join(root, ".smoke-tmp"), { recursive: true, force: true });
  console.log(failed ? "== SMOKE FAILED" : "== SMOKE PASSED (server stopped)");
  process.exit(failed ? 1 : 0);
}
