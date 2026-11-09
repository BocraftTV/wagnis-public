// Dev runner: starts the server (tsx) and the Vite dev server together.
// Usage: `npm run dev` from the repo root. Needs a `.env` (copy `.env.example`).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const path = (rel) => fileURLToPath(new URL(rel, root));

if (!existsSync(path(".env"))) {
  console.error("Keine .env gefunden. Bitte .env.example nach .env kopieren und ausfüllen.");
  process.exit(1);
}
// Children inherit the values (the Vite proxy reads PORT). Values are never printed.
process.loadEnvFile(path(".env"));

// Run the tool binaries with the current Node directly: no shell, no npm wrapper process.
const services = [
  {
    name: "server",
    cwd: path("apps/server/"),
    args: [path("node_modules/tsx/dist/cli.mjs"), "--conditions=wagnis-source", "src/index.ts"],
  },
  {
    name: "client",
    cwd: path("apps/client/"),
    args: [path("node_modules/vite/bin/vite.js"), "--host"],
  },
];

const children = new Set();
let shuttingDown = false;
let exitCode = 0;

function stopAll(signal = "SIGTERM") {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

function shutdown(code, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  stopAll(signal);
  // Escalate if a child ignores the signal.
  setTimeout(() => stopAll("SIGKILL"), 5000).unref();
  if (children.size === 0) process.exit(exitCode);
}

for (const { name, cwd, args } of services) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  children.add(child);
  child.on("error", (err) => {
    console.error(`[dev] ${name} konnte nicht gestartet werden: ${err.message}`);
    children.delete(child);
    shutdown(1, "SIGTERM");
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[dev] ${name} beendet (${signal ?? code}), stoppe den Rest.`);
      shutdown(code ?? 1, "SIGTERM");
    }
    if (shuttingDown && children.size === 0) process.exit(exitCode);
  });
}

process.on("SIGINT", () => shutdown(130, "SIGTERM"));
process.on("SIGTERM", () => shutdown(143, "SIGTERM"));
