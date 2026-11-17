// WAGNIS_PUBLIC_URL: the address for the lobby QR code.
import { join } from "node:path";
import { createCode, check, Client, startServer, stopServer } from "./lib.mjs";

/**
 * Host functions (plan 007): lobby choice, removal in the lobby (4004, token worthless), skipping, host handover (only to
 * a connected player), removal in a running game (4004, marks for everybody), a win by removal, back to the lobby
 * (game number 2, players stay) and a second game. Everything over the real HTTP and WebSocket interfaces.
 */
/** WAGNIS_PUBLIC_URL (plan 008): the address is in the lobby snapshot only, `null` in the game and without the variable. */
export async function publicUrlSection({ port, base, post }) {
  console.log("== public url: lobby snapshot only");
  const address = "http://example.test:3000";
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  await stopServer();
  await startServer(port, base, { WAGNIS_PUBLIC_URL: `${address}/` });
  const created = await post("/api/rooms", { createCode, hostName: "Lena", mapId: "testland" });
  const joined = await post(`/api/rooms/${created.body.roomId}/join`, { name: "Max" });
  const roomId = created.body.roomId;
  const lena = new Client("Lena", wsUrl);
  const max = new Client("Max", wsUrl);
  await Promise.all([lena.ready, max.ready]);
  lena.send({ type: "hello", roomId, token: created.body.playerToken });
  max.send({ type: "hello", roomId, token: joined.body.playerToken });
  await Promise.all([
    lena.until((v) => v.players.length === 2, "lobby"),
    max.until((v) => v.players.length === 2, "lobby"),
  ]);
  check(
    lena.view.publicUrl === address && max.view.publicUrl === address,
    "lobby snapshot carries the normalised public address for both players",
  );
  lena.send({ type: "start" });
  await Promise.all([
    lena.until((v) => v.status === "playing", "start"),
    max.until((v) => v.status === "playing", "start"),
  ]);
  check(
    lena.view.publicUrl === null && max.view.publicUrl === null,
    "snapshot in the game has publicUrl null",
  );
  const wire = [...lena.raw, ...max.raw].join("\n");
  check(
    ![created.body.playerToken, joined.body.playerToken, createCode, "tokenHash"].some((x) =>
      wire.includes(x),
    ),
    "no token, code or hash next to the public address",
  );
  lena.ws.close();
  max.ws.close();
  await stopServer();
  await startServer(port, base);
  const plain = await post("/api/rooms", { createCode, hostName: "Nora", mapId: "testland" });
  const nora = new Client("Nora", wsUrl);
  await nora.ready;
  nora.send({ type: "hello", roomId: plain.body.roomId, token: plain.body.playerToken });
  await nora.until((v) => v.status === "lobby", "lobby without the variable");
  check(nora.view.publicUrl === null, "without WAGNIS_PUBLIC_URL the lobby has publicUrl null");
  nora.ws.close();
}
