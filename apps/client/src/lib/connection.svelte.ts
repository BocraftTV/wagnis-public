import { WS_CLOSE_RATE_LIMITED, serverMessageSchema } from "@wagnis/shared";
import type { ActionMessage, ClientMessage, RoomView } from "@wagnis/shared";
import { wsErrorText } from "./messages.js";
import { acceptSnapshot, actionForClose, backoffDelay } from "./policy.js";

export type ConnStatus = "idle" | "connecting" | "open" | "reconnecting" | "replaced" | "rejected";

/** The subset of WebSocket the connection uses (lets tests inject a fake). */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface ConnectionDeps {
  createSocket: (url: string) => SocketLike;
  wsUrl: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const OPEN = 1;
const NOTICE_MS = 4000;
/** After this long in the background a socket may be silently dead: replace it on return. */
const STALE_AFTER_MS = 5000;

const browserDeps = (): ConnectionDeps => ({
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  wsUrl: () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

/** Keeps one authenticated WebSocket alive and mirrors the latest server snapshot. */
export class GameConnection {
  status = $state<ConnStatus>("idle");
  view = $state.raw<RoomView | null>(null);
  notice = $state<string | null>(null);

  private roomId = "";
  private token = "";
  private socket: SocketLike | null = null;
  private attempt = 0;
  private retryTimer: unknown = null;
  private noticeTimer: unknown = null;
  private hiddenAt: number | null = null;
  private reqCounter = 0;
  private stopped = true;

  constructor(
    /** The token is no good any more: `"invalid"` (unknown, room deleted) or `"removed"` (the host removed this player). */
    private readonly onRejected: (reason: "invalid" | "removed") => void = () => {},
    private readonly deps: ConnectionDeps = browserDeps(),
  ) {}

  start(roomId: string, token: string): void {
    this.roomId = roomId;
    this.token = token;
    this.stopped = false;
    this.status = "connecting";
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.cancelRetry();
    this.detach();
    this.status = "idle";
  }

  /** "Hier fortsetzen" after another window replaced this one. */
  resume(): void {
    if (this.stopped) return;
    this.attempt = 0;
    this.status = "connecting";
    this.open();
  }

  private detach(): void {
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {
        /* already closed */
      }
    }
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.deps.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private open(): void {
    this.cancelRetry();
    this.detach();
    const socket = this.deps.createSocket(this.deps.wsUrl());
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: "hello", roomId: this.roomId, token: this.token }));
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.handleMessage(ev.data);
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.handleClose(ev.code);
    };
    socket.onerror = () => {
      /* a close event follows */
    };
  }

  private handleMessage(data: unknown): void {
    let json: unknown;
    try {
      json = typeof data === "string" ? JSON.parse(data) : undefined;
    } catch {
      return;
    }
    const msg = serverMessageSchema.safeParse(json);
    if (!msg.success) return;
    if (msg.data.type === "snapshot") {
      if (acceptSnapshot(this.view, msg.data.view)) this.view = msg.data.view;
      this.attempt = 0;
      this.status = "open";
    } else {
      this.showNotice(wsErrorText[msg.data.code]);
    }
  }

  private handleClose(code: number): void {
    this.socket = null;
    if (this.stopped) return;
    const action = actionForClose(code);
    if (action === "rejected" || action === "removed") {
      this.status = "rejected";
      this.onRejected(action === "removed" ? "removed" : "invalid");
    } else if (action === "replaced") {
      this.status = "replaced";
    } else {
      if (code === WS_CLOSE_RATE_LIMITED) this.showNotice(wsErrorText.RATE_LIMITED);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.status = "reconnecting";
    this.cancelRetry();
    this.retryTimer = this.deps.setTimer(() => this.open(), backoffDelay(this.attempt++));
  }

  /** Connect right now (page became visible, network came back). */
  reconnectNow(): void {
    if (this.stopped || this.status === "replaced" || this.status === "rejected") return;
    this.attempt = 0;
    if (this.status === "open") this.status = "reconnecting";
    this.open();
  }

  onVisibilityChange(visible: boolean, now: number): void {
    if (!visible) {
      this.hiddenAt = now;
      return;
    }
    const wasHiddenFor = this.hiddenAt === null ? 0 : now - this.hiddenAt;
    this.hiddenAt = null;
    const alive = this.socket?.readyState === OPEN && this.status === "open";
    if (!alive || wasHiddenFor > STALE_AFTER_MS) this.reconnectNow();
  }

  onOnline(): void {
    this.reconnectNow();
  }

  private showNotice(text: string): void {
    this.notice = text;
    if (this.noticeTimer !== null) this.deps.clearTimer(this.noticeTimer);
    this.noticeTimer = this.deps.setTimer(() => (this.notice = null), NOTICE_MS);
  }

  private sendJson(msg: unknown): boolean {
    if (this.socket?.readyState !== OPEN || this.status !== "open") {
      this.showNotice("Keine Verbindung.");
      return false;
    }
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  sendAction(action: ActionMessage): boolean {
    return this.sendJson({ type: "action", reqId: `c${++this.reqCounter}`, action });
  }

  sendStart(): boolean {
    return this.sendJson({ type: "start" });
  }

  /** Host messages (`settings`, `host`, `backToLobby`), built by `lib/host.ts`; the server checks the host. */
  sendHost(message: ClientMessage): boolean {
    return this.sendJson(message);
  }
}
