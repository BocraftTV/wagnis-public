// One-off script (plan 004, step 0): plays real games against the built Phase-3 server (HTTP + WebSocket,
// temporary SQLite database) and writes the saved `rooms.state_json` rows, unchanged apart from
// formatting, to apps/server/fixtures/. Run it only on a checkout that still has the Phase-3 code:
//   npm run build && node scripts/make-phase3-fixture.mjs
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
const tmp = mkdtempSync(join(tmpdir(), "wagnis-fixture-"));
const createCode = randomBytes(12).toString("hex");
const { getMap } = await import(
  new URL("../packages/engine/dist/map-data.js", import.meta.url).href
);
const map = getMap("testland");
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

async function playRun(port, names, completedTurns) {
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
  const host = await post("/api/rooms", { createCode, hostName: names[0] });
  const joined = [host];
  for (const name of names.slice(1))
    joined.push(await post(`/api/rooms/${host.roomId}/join`, { name }));
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
  // next turn: stop in the attack phase after one attack with a conquest
  const active = byId[clients[0].view.game.activePlayerId];
  await reinforce(active);
  await conquer(active);
  const g = active.view.game;
  if (g.phase !== "attack" || g.pendingOccupation) throw new Error("not in the attack phase");
  const cards = Object.values(g.handCounts).reduce((a, b) => a + b, 0);
  if (cards < 1) throw new Error("no drawn card");
  console.log(
    `   ${names.length} players: turn ${g.turn}, phase ${g.phase}, cards in hands ${cards}`,
  );
  clients.forEach((c) => c.ws.close());
  await new Promise((r) => setTimeout(r, 100));
  return host.roomId;
}

function readRow(roomId) {
  const db = new Database(join(tmp, "fixture.db"), { readonly: true });
  try {
    return db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId).state_json;
  } finally {
    db.close();
  }
}

try {
  mkdirSync(outDir, { recursive: true });
  const port = await freePort();
  await startServer(port);
  const rooms = {
    "phase3-3p.json": await playRun(port, ["Anna", "Ben", "Cleo"], 3),
    "phase3-2p.json": await playRun(port, ["Anna", "Ben"], 2),
  };
  await stopServer();
  for (const [file, roomId] of Object.entries(rooms)) {
    const raw = readRow(roomId);
    // unchanged content, only pretty-printed
    writeFileSync(join(outDir, file), JSON.stringify(JSON.parse(raw), null, 2) + "\n");
    console.log(`wrote apps/server/fixtures/${file}`);
  }
} finally {
  await stopServer();
  rmSync(tmp, { recursive: true, force: true });
}
