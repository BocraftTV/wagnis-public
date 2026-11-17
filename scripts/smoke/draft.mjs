// Mission draft ("two draw, keep one").
import { join } from "node:path";
import { createCode, check, Client, startServer, stopServer, until } from "./lib.mjs";

/**
 * "Two missions, keep one" with three players (plan 013): each sees only the own two offers, the choice runs at the
 * same time on three connections, survives a server restart in the middle, and the first turn starts after the last choice.
 */
export async function draftSection({ port, base, post }) {
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
