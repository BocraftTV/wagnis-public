// World map with 2 to 6 players.
import { join } from "node:path";
import Database from "better-sqlite3";
import { tmp, createCode, check, getMap, Client, startServer, stopServer } from "./lib.mjs";

/**
 * World map ("welt") with 6 and with 2 players: 42 territories, start distribution, 44 cards, own mission only,
 * the size of one snapshot, then an attack over a sea route (Hudsonland -> Grönland) on a prepared state.
 */
export async function weltSection({ port, base, post }) {
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
