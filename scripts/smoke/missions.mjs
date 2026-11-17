// Missions: a game won by a mission, the resolution.
import { join } from "node:path";
import Database from "better-sqlite3";
import { tmp, createCode, check, Client, startServer, stopServer, until } from "./lib.mjs";

/**
 * Missions with three players: each sees only the own mission; then a prepared state (one winner by mission, one
 * replaced mission, one self-target draw) shows the resolution to everybody, also after a restart.
 */
export async function missionSection({ port, base, post }) {
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
