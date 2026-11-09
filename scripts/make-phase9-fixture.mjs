// One-off script (plan 014 A): plays real games against the built Phase-8 server (state version 7,
// schema 5; HTTP + WebSocket, temporary SQLite database) and writes the saved `rooms` and `players` rows (token
// hashes replaced by placeholders) plus the old CREATE statements to apps/server/fixtures/. Run it only on a
// checkout that still has this code (nothing of plan 014 in apps/ or packages/):
//   npm run build && node scripts/make-phase9-fixture.mjs
// Plain Node, no shell features. The server is stopped at the end; nothing keeps running.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "apps/server/fixtures");
const tmp = mkdtempSync(join(tmpdir(), "wagnis-fixture9-"));
const createCode = randomBytes(12).toString("hex");
const { getMap } = await import(
  new URL("../packages/engine/dist/map-data.js", import.meta.url).href
);
let map = getMap("testland");
let server;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

class Client {
  constructor(name, url) {
    this.name = name;
    this.view = null;
    this.errors = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`${name}: websocket error`));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "snapshot") this.view = msg.view;
      else this.errors.push(msg);
    };
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  async until(pred, label) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (this.view && pred(this.view)) return this.view;
      if (this.errors.length > 0) throw new Error(`${this.name}: ${JSON.stringify(this.errors)}`);
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`${this.name}: timeout waiting for ${label}`);
  }
}

async function startServer(port) {
  server = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      WAGNIS_CREATE_CODE: createCode,
      WAGNIS_DB_PATH: join(tmp, "fixture.db"),
    },
    stdio: "ignore",
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (i > 100) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function stopServer() {
  const s = server;
  if (!s) return;
  server = undefined;
  s.kill("SIGTERM");
  await new Promise((resolve) => {
    s.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  s.kill("SIGKILL");
}

/** Attacks (blitz) from any legal pair until the turn has a conquest; occupies with the maximum. */
async function conquer(active) {
  for (let attempt = 0; attempt < 12 && !active.view.game.conqueredThisTurn; attempt++) {
    const g = active.view.game;
    const me = g.activePlayerId;
    const pairs = [];
    for (const [from, t] of Object.entries(g.territories)) {
      if (t.ownerId !== me || t.maxAttackDice < 1) continue;
      for (const to of map.territories.find((x) => x.id === from).neighbors) {
        if (g.territories[to].ownerId !== me) {
          pairs.push({ from, to, score: t.armies - g.territories[to].armies });
        }
      }
    }
    if (pairs.length === 0) throw new Error("no legal attack");
    pairs.sort((a, b) => b.score - a.score);
    const { from, to } = pairs[0];
    const seq = g.lastCombat?.seq ?? 0;
    active.send({ type: "action", action: { type: "blitz", from, to } });
    await active.until((v) => (v.game.lastCombat?.seq ?? 0) > seq, "blitz");
    const pending = active.view.game.pendingOccupation;
    if (pending) {
      active.send({ type: "action", action: { type: "occupy", count: pending.max } });
      await active.until((v) => v.game.pendingOccupation === null, "occupy");
    }
    if (active.view.game.winnerId) throw new Error("game ended, rerun");
  }
  if (!active.view.game.conqueredThisTurn) throw new Error("no conquest after 12 blitzes");
}

async function reinforce(active) {
  const g = active.view.game;
  const me = g.activePlayerId;
  // put everything on the strongest own territory that borders a foreign one, so an attack is possible
  const border = Object.entries(g.territories)
    .filter(
      ([id, t]) =>
        t.ownerId === me &&
        map.territories
          .find((x) => x.id === id)
          .neighbors.some((n) => g.territories[n].ownerId !== me),
    )
    .sort((a, b) => b[1].armies - a[1].armies);
  const target = border[0][0];
  for (let left = g.reinforcementsLeft; left > 0; left--) {
    const before = active.view.game.territories[target].armies;
    active.send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
    await active.until((v) => v.game.territories[target].armies === before + 1, "placeArmies");
  }
  active.send({ type: "action", action: { type: "endPhase" } });
  await active.until((v) => v.game.phase === "attack", "phase attack");
}

/** Plays `completedTurns` full turns, then stops in `stop`: "reinforce", "fortify" or "attack" (after a conquest). */
async function playRun(port, names, completedTurns, mapId, stop) {
  map = getMap(mapId);
  const { host, joined } = await openRoom(port, names, mapId);
  const clients = joined.map((j, i) => new Client(names[i], `ws://127.0.0.1:${port}/ws`));
  await Promise.all(clients.map((c) => c.ready));
  clients.forEach((c, i) =>
    c.send({ type: "hello", roomId: host.roomId, token: joined[i].playerToken }),
  );
  await clients[0].until((v) => v.players.length === names.length, "all joined");
  clients[0].send({ type: "start" });
  await Promise.all(clients.map((c) => c.until((v) => v.status === "playing", "start")));
  const byId = Object.fromEntries(joined.map((j, i) => [j.playerId, clients[i]]));

  for (let turn = 1; turn <= completedTurns; turn++) {
    const active = byId[clients[0].view.game.activePlayerId];
    await reinforce(active);
    await conquer(active);
    active.send({ type: "action", action: { type: "endPhase" } });
    await active.until((v) => v.game.phase === "fortify", "phase fortify");
    active.send({ type: "action", action: { type: "endPhase" } });
    await active.until((v) => v.game.turn === turn + 1 && v.game.phase === "reinforce", "turn end");
  }
  if (stop !== "reinforce") {
    const active = byId[clients[0].view.game.activePlayerId];
    await reinforce(active);
    await conquer(active);
    if (stop === "fortify") {
      active.send({ type: "action", action: { type: "endPhase" } });
      await active.until((v) => v.game.phase === "fortify", "phase fortify");
    }
  }
  const g = clients[0].view.game;
  if (g.phase !== stop || g.pendingOccupation) throw new Error(`not in phase ${stop}`);
  const cards = Object.values(g.handCounts).reduce((a, b) => a + b, 0);
  const owners = new Set(Object.values(g.territories).map((t) => t.ownerId));
  console.log(
    `   ${names.length} players: turn ${g.turn}, phase ${g.phase}, cards in hands ${cards}, conquered ${g.conqueredThisTurn}, neutral owner ${owners.has(null)}`,
  );
  clients.forEach((c) => c.ws.close());
  await new Promise((r) => setTimeout(r, 100));
  return host.roomId;
}

async function openRoom(port, names, mapId) {
  const base = `http://127.0.0.1:${port}`;
  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  const host = await post("/api/rooms", { createCode, hostName: names[0], mapId });
  const joined = [host];
  for (const name of names.slice(1))
    joined.push(await post(`/api/rooms/${host.roomId}/join`, { name }));
  return { post, host, joined };
}

/** Rows of one room exactly as stored, except that token hashes are replaced by placeholders. */
function readRows(roomId, label) {
  const db = new Database(join(tmp, "fixture.db"), { readonly: true });
  try {
    const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
    const players = db
      .prepare("SELECT * FROM players WHERE room_id = ? ORDER BY seat")
      .all(roomId)
      .map((p) => ({ ...p, token_hash: `PLACEHOLDER-TOKEN-HASH-${label}-${p.seat}` }));
    if (room.state_json !== null) {
      const parsed = JSON.parse(room.state_json);
      // pretty-printing must not change the content
      if (JSON.stringify(parsed) !== room.state_json)
        throw new Error("state_json not round-trippable");
      room.state_json = parsed;
    }
    return { label, room, players };
  } finally {
    db.close();
  }
}

function readSchema() {
  const db = new Database(join(tmp, "fixture.db"), { readonly: true });
  try {
    const rows = db
      .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
      .all();
    const version = db.prepare("SELECT version FROM schema_meta").get().version;
    return { sql: rows.map((r) => r.sql + ";").join("\n"), version };
  } finally {
    db.close();
  }
}

/**
 * A finished room: three players on testland; the stored state is prepared (the first player gets a mission that is
 * already satisfied), the server restarts, and the real server ends the game with one placeArmies action, so the
 * `finished` row is written by the Phase-5 code itself.
 */
async function finishedRoom(port) {
  const names = ["Anna", "Ben", "Cleo"];
  const { host, joined } = await openRoom(port, names, "testland");
  const roomId = host.roomId;
  const connect = async () => {
    const clients = joined.map((j, i) => new Client(names[i], `ws://127.0.0.1:${port}/ws`));
    await Promise.all(clients.map((c) => c.ready));
    clients.forEach((c, i) => c.send({ type: "hello", roomId, token: joined[i].playerToken }));
    return clients;
  };
  let clients = await connect();
  await clients[0].until((v) => v.players.length === 3, "all joined");
  clients[0].send({ type: "start" });
  await Promise.all(clients.map((c) => c.until((v) => v.status === "playing", "start")));
  clients.forEach((c) => c.ws.close());
  await new Promise((r) => setTimeout(r, 100));
  await stopServer();
  const db = new Database(join(tmp, "fixture.db"));
  const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId);
  const state = JSON.parse(row.state_json);
  const a = state.activePlayerId;
  const easy = { type: "holdTerritories", count: 1, minArmies: 1 };
  const hard = { type: "holdTerritories", count: 8, minArmies: 99 };
  for (const id of state.playerOrder) {
    const m = id === a ? easy : hard;
    state.secret.mission[id] = m;
    state.secret.originalMission[id] = m;
    state.secret.missionReplaced[id] = false;
  }
  db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
  db.close();
  await startServer(port);
  clients = await connect();
  const byId = Object.fromEntries(joined.map((j, i) => [j.playerId, clients[i]]));
  await Promise.all(clients.map((c) => c.until((v) => v.game?.turn === 1, "restored game")));
  const target = Object.entries(byId[a].view.game.territories).find(([, t]) => t.ownerId === a)[0];
  byId[a].send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
  await Promise.all(clients.map((c) => c.until((v) => v.game.winnerId === a, "win by mission")));
  if (clients[0].view.status !== "finished") throw new Error("room is not finished");
  console.log(`   finished room: winReason ${clients[0].view.game.winReason}`);
  clients.forEach((c) => c.ws.close());
  await new Promise((r) => setTimeout(r, 100));
  return roomId;
}

/** A lobby room whose host has chosen the map, the victory mode and two fortify moves (nothing else is stored yet). */
async function lobbyRoom(port) {
  const names = ["Anna", "Ben"];
  const { host, joined } = await openRoom(port, names);
  const client = new Client(names[0], `ws://127.0.0.1:${port}/ws`);
  await client.ready;
  client.send({ type: "hello", roomId: host.roomId, token: joined[0].playerToken });
  await client.until((v) => v.players.length === 2, "all joined");
  client.send({ type: "settings", mapId: "testland", victoryMode: "domination", fortifyMoves: 2 });
  await client.until(
    (v) => v.mapId === "testland" && v.victoryMode === "domination" && v.fortifyMoves === 2,
    "settings",
  );
  client.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  return host.roomId;
}

try {
  mkdirSync(outDir, { recursive: true });
  const port = await freePort();
  await startServer(port);
  const lobbyId = await lobbyRoom(port);
  const reinforceId = await playRun(port, ["Anna", "Ben", "Cleo"], 1, "welt", "reinforce");
  const fortifyId = await playRun(port, ["Anna", "Ben"], 1, "testland", "fortify");
  const attackId = await playRun(port, ["Anna", "Ben", "Cleo"], 1, "testland", "attack");
  const done = await finishedRoom(port);
  await stopServer();
  const rooms = [
    readRows(lobbyId, "lobby"),
    readRows(reinforceId, "playing-3p-welt-reinforce"),
    readRows(fortifyId, "playing-2p-neutral-fortify"),
    readRows(attackId, "playing-3p-attack-conquered"),
    readRows(done, "finished"),
  ];
  const { sql, version } = readSchema();
  writeFileSync(
    join(outDir, "phase9-rooms.json"),
    JSON.stringify({ schemaMetaVersion: version, rooms }, null, 2) + "\n",
  );
  writeFileSync(join(outDir, "phase9-schema.sql"), sql + "\n");
  console.log("wrote apps/server/fixtures/phase9-rooms.json and phase9-schema.sql");
} finally {
  await stopServer();
  rmSync(tmp, { recursive: true, force: true });
}
