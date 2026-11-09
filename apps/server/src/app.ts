import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from "fastify";
import type { Rng } from "@wagnis/engine";
import {
  createRoomRequestSchema,
  isValidRoomId,
  joinRoomRequestSchema,
  normalizeRoomId,
} from "@wagnis/shared";
import type { CreateRoomResponse, HttpError, HttpErrorCode, JoinResponse } from "@wagnis/shared";
import type { Config } from "./config.js";
import { cryptoRng, generateRoomId, hashToken, newToken, secretsEqual } from "./crypto.js";
import { Hub } from "./hub.js";
import { clientIp } from "./ip.js";
import { FailureLimiter } from "./rate-limit.js";
import { Store } from "./store.js";
import { IDLE_MS, SWEEP_INTERVAL_MS, startSweeper } from "./sweeper.js";
import { registerWebSocket } from "./ws.js";

export interface AppOptions {
  config: Config;
  rng?: Rng;
  now?: () => number;
  logger?: FastifyServerOptions["logger"];
  /** Directory with the built client; null disables static serving. */
  clientDist?: string | null;
  helloTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  createFailureLimit?: number;
  joinFailureLimit?: number;
  limitWindowMs?: number;
  /** Idle time after which a room is deleted (default 48 h; a test seam, no environment variable). */
  idleMs?: number;
  /** Interval of the cleanup (default 1 h; a test seam). */
  sweepIntervalMs?: number;
}

/** Request logging without query strings or bodies. */
export const productionLogger = {
  level: "info",
  serializers: {
    req: (req: FastifyRequest) => ({ method: req.method, url: req.url.split("?")[0] ?? "" }),
  },
} as const;

const defaultClientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));

const STATUS: Record<HttpErrorCode, number> = {
  VALIDATION: 400,
  BAD_CREATE_CODE: 403,
  ROOM_NOT_FOUND: 404,
  ROOM_NOT_JOINABLE: 409,
  ROOM_FULL: 409,
  NAME_TAKEN: 409,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  INTERNAL: 500,
};
const MESSAGES: Record<HttpErrorCode, string> = {
  VALIDATION: "Invalid input.",
  BAD_CREATE_CODE: "Wrong create code.",
  ROOM_NOT_FOUND: "Room not found.",
  ROOM_NOT_JOINABLE: "The game has already started.",
  ROOM_FULL: "The room is full.",
  NAME_TAKEN: "That name is already taken.",
  RATE_LIMITED: "Too many failed attempts. Try again later.",
  NOT_FOUND: "Not found.",
  INTERNAL: "Internal error.",
};

export async function buildApp(
  options: AppOptions,
): Promise<{ app: FastifyInstance; store: Store; hub: Hub }> {
  const { config } = options;
  const now = options.now ?? Date.now;
  const rng = options.rng ?? cryptoRng;
  const windowMs = options.limitWindowMs ?? 10 * 60 * 1000;
  const createLimiter = new FailureLimiter(options.createFailureLimit ?? 5, windowMs, now);
  const joinLimiter = new FailureLimiter(options.joinFailureLimit ?? 30, windowMs, now);

  const store = new Store(config.dbPath);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 4096 });
  const hub = new Hub(store, app.log, config.publicUrl);

  app.addHook("preClose", async () => {
    hub.shutdown();
  });
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    sweeper.stop();
    store.close();
  });
  const cleanup = setInterval(() => {
    createLimiter.cleanup();
    joinLimiter.cleanup();
  }, 60_000);
  cleanup.unref();

  // First sweep right now (before the first request), then hourly; only the number of deleted rooms is logged
  const sweeper = startSweeper({
    store,
    hub,
    now,
    maxIdleMs: options.idleMs ?? IDLE_MS,
    intervalMs: options.sweepIntervalMs ?? SWEEP_INTERVAL_MS,
    onSwept: (deleted) => app.log.info({ deleted }, "idle rooms removed"),
  });

  const ipOf = (req: FastifyRequest) => clientIp(req.headers, req.ip, config.trustProxyHeader);
  const httpError = (code: HttpErrorCode): HttpError & { status: number } => ({
    status: STATUS[code],
    error: { code, message: MESSAGES[code] },
  });
  const reject = (reply: import("fastify").FastifyReply, code: HttpErrorCode) =>
    reply.code(STATUS[code]).send({ error: httpError(code).error } satisfies HttpError);

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Robots-Tag", "noindex");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const statusCode = err.statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reject(reply, "VALIDATION");
    }
    // Log only error identifiers: messages can echo request data.
    req.log.error({ name: err.name, code: err.code }, "unhandled error");
    return reject(reply, "INTERNAL");
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/api/rooms", async (req, reply) => {
    const ip = ipOf(req);
    if (createLimiter.isBlocked(ip)) return reject(reply, "RATE_LIMITED");
    const body = createRoomRequestSchema.safeParse(req.body);
    if (!body.success) return reject(reply, "VALIDATION");
    if (!secretsEqual(body.data.createCode, config.createCode)) {
      createLimiter.recordFailure(ip);
      return reject(reply, "BAD_CREATE_CODE");
    }
    const roomId = generateRoomId((id) => store.roomExists(id));
    const token = newToken();
    const playerId = crypto.randomUUID();
    store.createRoom(
      roomId,
      body.data.mapId,
      { id: playerId, name: body.data.hostName, tokenHash: hashToken(token) },
      now(),
    );
    return reply
      .code(201)
      .send({ roomId, playerId, playerToken: token } satisfies CreateRoomResponse);
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/join", async (req, reply) => {
    const ip = ipOf(req);
    if (joinLimiter.isBlocked(ip)) return reject(reply, "RATE_LIMITED");
    const roomId = normalizeRoomId(req.params.id);
    if (!isValidRoomId(roomId) || !store.roomExists(roomId)) {
      joinLimiter.recordFailure(ip);
      return reject(reply, "ROOM_NOT_FOUND");
    }
    const body = joinRoomRequestSchema.safeParse(req.body);
    if (!body.success) return reject(reply, "VALIDATION");
    const token = newToken();
    const playerId = crypto.randomUUID();
    const result = store.addPlayer(
      roomId,
      { id: playerId, name: body.data.name, tokenHash: hashToken(token) },
      now(),
    );
    if (!result.ok) return reject(reply, result.code);
    hub.broadcast(roomId);
    return reply.send({ playerId, playerToken: token } satisfies JoinResponse);
  });

  await registerWebSocket(app, {
    store,
    hub,
    rng,
    now,
    joinLimiter,
    trustProxyHeader: config.trustProxyHeader,
    helloTimeoutMs: options.helloTimeoutMs ?? 5000,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 25_000,
  });

  const clientDist = options.clientDist === undefined ? defaultClientDist : options.clientDist;
  const serveClient = clientDist !== null && existsSync(clientDist);
  if (serveClient) {
    await app.register(fastifyStatic, {
      root: clientDist,
      setHeaders: (reply, path) => {
        reply.header(
          "Cache-Control",
          path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    const isApi = path === "/api" || path.startsWith("/api/") || path === "/ws";
    const looksLikeFile = /\.[A-Za-z0-9]+$/.test(path);
    if (serveClient && req.method === "GET" && !isApi && !looksLikeFile) {
      return reply.header("Cache-Control", "no-cache").type("text/html").sendFile("index.html");
    }
    return reject(reply, "NOT_FOUND");
  });

  await app.ready();
  return { app, store, hub };
}
