// Round limit and the score at the end.
import { join } from "node:path";
import { createCode, check, Client, until } from "./lib.mjs";

/**
 * Round limit (plan 014 A): the lobby setting, "Round 1 of 8" in the view, and the score after round 8, reached by
 * the host skipping every turn. Both players see the same score; nobody sees an error.
 */
export async function roundLimitSection({ port, post }) {
  console.log("== round limit: lobby setting 8, the host skips 16 turns, the score ends the game");
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const created = await post("/api/rooms", { createCode, hostName: "Rita", mapId: "testland" });
  const roomId = created.body.roomId;
  const joined = await post(`/api/rooms/${roomId}/join`, { name: "Sven" });
  const rita = new Client("Rita", wsUrl);
  const sven = new Client("Sven", wsUrl);
  await Promise.all([rita.ready, sven.ready]);
  rita.send({ type: "hello", roomId, token: created.body.playerToken });
  sven.send({ type: "hello", roomId, token: joined.body.playerToken });
  await Promise.all([rita, sven].map((c) => c.until((v) => v.players.length === 2, "joined")));
  check(rita.view.roundLimit === null, "a new room has no round limit");
  sven.send({ type: "settings", roundLimit: 8 });
  await until(() => sven.errors.length > 0, "NOT_HOST");
  check(sven.errors.at(-1).code === "NOT_HOST", "a guest cannot set the round limit (NOT_HOST)");
  rita.send({ type: "settings", roundLimit: 10 });
  await until(() => rita.errors.length > 0, "BAD_MESSAGE");
  check(rita.errors.at(-1).code === "BAD_MESSAGE", "a limit that is not offered is BAD_MESSAGE");
  rita.send({ type: "settings", roundLimit: 8, victoryMode: "domination" });
  await Promise.all([rita, sven].map((c) => c.until((v) => v.roundLimit === 8, "limit 8")));
  rita.send({ type: "start" });
  await Promise.all([rita, sven].map((c) => c.until((v) => v.status === "playing", "start")));
  check(
    rita.view.game.round === 1 && rita.view.game.roundLimit === 8,
    "the game starts in round 1 of 8",
  );
  rita.errors.length = 0;
  sven.errors.length = 0;
  for (let i = 1; i <= 16; i++) {
    const turn = rita.view.game.turn;
    rita.send({ type: "host", action: { type: "skipTurn", turn } });
    await Promise.all(
      [rita, sven].map((c) =>
        c.until((v) => v.game.turn > turn || v.status === "finished", `skip ${i}`),
      ),
    );
  }
  const g = rita.view.game;
  check(
    rita.view.status === "finished" && g.winReason === "roundLimit" && g.round === 8,
    "after the 16th turn the game is finished by the round limit in round 8",
  );
  check(
    g.winnerIds.length >= 1 && g.winnerIds.includes(g.winnerId) && g.scores.length === 2,
    "winnerIds and a score with two lines",
  );
  check(
    JSON.stringify(g.scores) === JSON.stringify(sven.view.game.scores),
    "both players see the same score",
  );
  check(rita.errors.length === 0 && sven.errors.length === 0, "no server errors");
  rita.ws.close();
  sven.ws.close();
}
