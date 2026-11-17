// World events and the fog.
import { join } from "node:path";
import { createCode, check, Client, until } from "./lib.mjs";

/**
 * World events (plan 014 B): the lobby setting, an event in round 1 and a new one every round, the event deck stays
 * on the server, and the fog (put in force in the stored state) hides foreign armies in every view.
 */
export async function worldEventsSection({ port, post }) {
  console.log("== world events: lobby setting, an event per round, no deck on the wire");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const created = await post("/api/rooms", { createCode, hostName: "Wanda", mapId: "testland" });
  const roomId = created.body.roomId;
  const joined = await post(`/api/rooms/${roomId}/join`, { name: "Xaver" });
  const wanda = new Client("Wanda", wsUrl);
  const xaver = new Client("Xaver", wsUrl);
  await Promise.all([wanda.ready, xaver.ready]);
  wanda.send({ type: "hello", roomId, token: created.body.playerToken });
  xaver.send({ type: "hello", roomId, token: joined.body.playerToken });
  await Promise.all([wanda, xaver].map((c) => c.until((v) => v.players.length === 2, "joined")));
  check(wanda.view.worldEvents === false, "a new room has world events off");
  xaver.send({ type: "settings", worldEvents: true });
  await until(() => xaver.errors.length > 0, "NOT_HOST");
  check(xaver.errors.at(-1).code === "NOT_HOST", "a guest cannot switch events on (NOT_HOST)");
  wanda.send({ type: "settings", worldEvents: "yes" });
  await until(() => wanda.errors.length > 0, "BAD_MESSAGE");
  check(wanda.errors.at(-1).code === "BAD_MESSAGE", "a wrong type is BAD_MESSAGE");
  wanda.send({ type: "settings", worldEvents: true, victoryMode: "domination" });
  await Promise.all([wanda, xaver].map((c) => c.until((v) => v.worldEvents, "events on")));
  wanda.send({ type: "start" });
  await Promise.all([wanda, xaver].map((c) => c.until((v) => v.status === "playing", "start")));
  let g = wanda.view.game;
  check(
    g.worldEvent !== null && [6, 7].includes(g.worldEventsLeft) && g.round === 1,
    "round 1 starts with an event and six or seven cards left (a storm is skipped on testland)",
  );
  wanda.errors.length = 0;
  xaver.errors.length = 0;
  for (let i = 0; i < 2; i++) {
    const turn = wanda.view.game.turn;
    wanda.send({ type: "host", action: { type: "skipTurn", turn } });
    await Promise.all([wanda, xaver].map((c) => c.until((v) => v.game.turn > turn, "skip")));
  }
  const before = g.worldEventsLeft;
  g = wanda.view.game;
  check(
    g.round === 2 && g.worldEventsLeft < before,
    "round 2 drew the next card (the deck is shorter)",
  );
  check(
    JSON.stringify(wanda.view.game.worldEvent) === JSON.stringify(xaver.view.game.worldEvent),
    "both players see the same event",
  );
  check(
    ![...wanda.raw, ...xaver.raw].some((m) => m.includes("eventDeck")),
    "no eventDeck on the wire",
  );
  check(wanda.errors.length === 0 && xaver.errors.length === 0, "no server errors");
  wanda.ws.close();
  xaver.ws.close();
}
