// End-to-end smoke test: build, start the production server on a random port, play one full round
// with two WebSocket clients, print the result, stop the server. Plain Node, no shell features.
// The sections live in this folder, one module each; lib.mjs holds what they share.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  tmp,
  freePort,
  startServer,
  stopServer,
  hasFailed,
  markFailed,
  serverRunning,
} from "./lib.mjs";
import { buildSection } from "./bundle.mjs";
import { draftSection } from "./draft.mjs";
import { fortifySection } from "./fortify.mjs";
import { hostSection } from "./host.mjs";
import { httpSection } from "./http.mjs";
import { missionSection } from "./missions.mjs";
import { publicUrlSection } from "./public-url.mjs";
import { roundLimitSection } from "./round-limit.mjs";
import { firstRoundSection } from "./round.mjs";
import { teamsSection } from "./teams.mjs";
import { tradeSection } from "./trade.mjs";
import { weltSection } from "./welt.mjs";
import { worldEventsSection } from "./world-events.mjs";

async function main() {
  await buildSection();

  const port = await freePort();
  mkdirSync(tmp, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  await startServer(port, base);
  console.log(`== server up on random port ${port} (production mode, node on dist)`);

  await httpSection(base);

  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const { roomId, created, joined, anna, ben, names } = await firstRoundSection({
    port,
    base,
    post,
  });

  await tradeSection({
    port,
    base,
    roomId,
    tokens: {
      anna: created.body.playerToken,
      ben: joined.body.playerToken,
      annaId: created.body.playerId,
      benId: joined.body.playerId,
    },
    old: { anna, ben },
    names,
  });
  await missionSection({ port, base, post });
  await draftSection({ port, base, post });
  await weltSection({ port, base, post });
  await hostSection({ port, base, post });
  await fortifySection({ port, base, post });
  await roundLimitSection({ port, post });
  await worldEventsSection({ port, post });
  await teamsSection({ port, post });
  await publicUrlSection({ port, base, post });
}

try {
  await main();
} catch (err) {
  markFailed();
  console.log(`FAIL ${err.message}`);
} finally {
  if (serverRunning()) await stopServer();
  rmSync(join(root, ".smoke-tmp"), { recursive: true, force: true });
  console.log(hasFailed() ? "== SMOKE FAILED" : "== SMOKE PASSED (server stopped)");
  process.exit(hasFailed() ? 1 : 0);
}
