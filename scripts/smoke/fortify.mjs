// Fortify moves per turn (one or two).
import { join } from "node:path";
import { createCode, check, getMap, Client, until } from "./lib.mjs";

/**
 * Client bundle: no mission list (continent id sequences of the world missions, with quotes stripped, appear nowhere)
 * and no external request (no URL except the namespace and error-message strings of the libraries; HTML and CSS none).
 */
export async function fortifySection({ port, base, post }) {
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
