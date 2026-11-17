// Teams.
import { join } from "node:path";
import { createCode, check, Client, until } from "./lib.mjs";

/**
 * Teams (plan 014 C): four players, layout 2 vs 2, the host assigns, the start checks, every player sees the teams, only
 * partners see each other's hand field, and the turn order alternates between the teams.
 */
export async function teamsSection({ port, post }) {
  console.log("== teams: lobby layout, assignment, start, partner view");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const created = await post("/api/rooms", { createCode, hostName: "Tina", mapId: "testland" });
  const roomId = created.body.roomId;
  const joined = [];
  for (const name of ["Uwe", "Vera", "Willi"]) {
    joined.push(await post(`/api/rooms/${roomId}/join`, { name }));
  }
  const people = [
    { name: "Tina", playerId: created.body.playerId, token: created.body.playerToken },
    ...joined.map((j, i) => ({
      name: ["Uwe", "Vera", "Willi"][i],
      playerId: j.body.playerId,
      token: j.body.playerToken,
    })),
  ];
  const clients = people.map((p) => new Client(p.name, wsUrl));
  await Promise.all(clients.map((c) => c.ready));
  clients.forEach((c, i) => c.send({ type: "hello", roomId, token: people[i].token }));
  await Promise.all(clients.map((c) => c.until((v) => v.players.length === 4, "joined")));
  check(clients[0].view.teams === null, "a new room has no teams");
  clients[1].send({ type: "settings", teams: "2v2" });
  await until(() => clients[1].errors.length > 0, "NOT_HOST");
  check(clients[1].errors.at(-1).code === "NOT_HOST", "a guest cannot pick a layout (NOT_HOST)");
  clients[0].send({ type: "settings", teams: "2v2", victoryMode: "domination" });
  await Promise.all(clients.map((c) => c.until((v) => v.teams === "2v2", "layout")));
  clients[0].errors.length = 0;
  clients[0].send({ type: "start" });
  await until(() => clients[0].errors.length > 0, "INVALID_TEAMS");
  check(
    clients[0].errors.at(-1).code === "INVALID_TEAMS" && clients[0].view.status === "lobby",
    "the start without an assignment is INVALID_TEAMS",
  );
  clients[0].send({ type: "randomTeams" });
  await Promise.all(
    clients.map((c) => c.until((v) => v.players.every((p) => p.team !== null), "assigned")),
  );
  const count = (l) => clients[0].view.players.filter((p) => p.team === l).length;
  check(count("A") === 2 && count("B") === 2, "the random assignment makes two teams of two");
  clients[0].send({ type: "start" });
  await Promise.all(clients.map((c) => c.until((v) => v.status === "playing", "start")));
  const g = clients[0].view.game;
  check(
    g.teams !== null &&
      Object.keys(g.teams).length === 2 &&
      clients.every((c) => c.view.teams === "2v2"),
    "the game starts with two teams, visible to everybody",
  );
  const teamOf = (id) => Object.entries(g.teams).find(([, m]) => m.includes(id))[0];
  const order = g.playerOrder.map(teamOf);
  check(
    order[0] !== order[1] && order[0] === order[2] && order[1] === order[3],
    "the turn order alternates between the teams",
  );
  const mates = clients.every((c, i) => {
    const me = people[i].playerId;
    const expected = g.teams[teamOf(me)].filter((p) => p !== me);
    return JSON.stringify(Object.keys(c.view.game.secret.allyHands)) === JSON.stringify(expected);
  });
  check(mates, "everybody has the hand field of the partner only");
  check(
    clients.every((c) => c.view.game.secret.mission !== undefined) &&
      JSON.stringify(clients[0].view.game.secret.mission) ===
        JSON.stringify(
          clients[
            people.findIndex((p, i) => i !== 0 && teamOf(p.playerId) === teamOf(people[0].playerId))
          ].view.game.secret.mission,
        ),
    "team mates hold the same mission field (domination: none)",
  );
  check(
    clients.every((c) => c.errors.length <= 1),
    "no further server errors",
  );
  clients.forEach((c) => c.ws.close());
}
