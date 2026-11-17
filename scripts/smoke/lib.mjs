// Shared parts of the smoke test: paths, the check log, the server process, the WebSocket client.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const tmp = join(root, ".smoke-tmp", randomBytes(4).toString("hex"));
export const createCode = randomBytes(12).toString("hex");
let server;
let failed = false;

export const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed = true;
};
export const markFailed = () => {
  failed = true;
};
export const hasFailed = () => failed;
export const serverRunning = () => server !== undefined;

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Adjacency for picking a legal target (map data only, from the built engine package).
export const { getMap } = await import(
  new URL("../../packages/engine/dist/map-data.js", import.meta.url).href
).catch(() => ({ getMap: undefined }));

export class Client {
  constructor(name, url) {
    this.name = name;
    this.views = [];
    this.raw = [];
    this.errors = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`${name}: websocket error`));
    });
    this.closeCode = undefined;
    this.ws.onclose = (ev) => {
      this.closeCode = ev.code;
    };
    this.ws.onmessage = (ev) => {
      this.raw.push(String(ev.data));
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "snapshot") this.views.push(msg.view);
      else this.errors.push(msg);
    };
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  get view() {
    return this.views.at(-1);
  }
  async until(pred, label) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (this.view && pred(this.view)) return this.view;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`${this.name}: timeout waiting for ${label}`);
  }
}

export async function startServer(port, base, extraEnv = {}) {
  const env = { ...process.env };
  delete env.WAGNIS_PUBLIC_URL; // only what the section sets
  server = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: root,
    env: {
      ...env,
      ...extraEnv,
      PORT: String(port),
      WAGNIS_CREATE_CODE: createCode,
      WAGNIS_DB_PATH: join(tmp, "smoke.db"),
    },
    stdio: "ignore",
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 100) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function stopServer() {
  const s = server;
  server = undefined;
  s.kill("SIGTERM");
  await new Promise((resolve) => {
    s.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
  s.kill("SIGKILL");
}

export async function until(pred, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout waiting for ${label}`);
}
