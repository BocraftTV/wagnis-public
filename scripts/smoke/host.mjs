// Host functions: skip, remove, hand over, back to the lobby.
import { join } from "node:path";
import { createCode, check, Client, until } from "./lib.mjs";

export async function hostSection({ port, base, post }) {
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
