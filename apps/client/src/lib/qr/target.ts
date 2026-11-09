import { MAX_VERSION } from "./tables.js";
import { maxBytes } from "./encode.js";

export type QrTarget = { kind: "url"; url: string } | { kind: "localhost" } | { kind: "tooLong" };

export interface QrTargetInput {
  /** `location.href` of the page. */
  pageUrl: string;
  /** `RoomView.publicUrl` (an origin, already checked by the server) or `null`. */
  publicUrl: string | null;
  /** Public room code, unformatted (`K7M2XQ`). */
  roomId: string;
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "" ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    h === "[::1]" ||
    h === "[::]" ||
    h === "0.0.0.0"
  );
}

/**
 * The address the QR code points to (rules.md 10.5): `publicUrl` if the server has one, otherwise the origin of the
 * page. Always plus `/r/<room code>`; never the page's path, query or fragment, and never a token.
 */
export function qrTarget({ pageUrl, publicUrl, roomId }: QrTargetInput): QrTarget {
  const code = roomId.replaceAll("-", "");
  let origin: string;
  if (publicUrl !== null) {
    origin = publicUrl.replace(/\/+$/, "");
  } else {
    let page: URL;
    try {
      page = new URL(pageUrl);
    } catch {
      return { kind: "localhost" };
    }
    if (page.protocol !== "http:" && page.protocol !== "https:") return { kind: "localhost" };
    if (isLocalHost(page.hostname)) return { kind: "localhost" };
    origin = page.origin;
  }
  const url = `${origin}/r/${code}`;
  // the encoder takes ASCII up to the capacity of its largest version
  if (url.length > maxBytes(MAX_VERSION) || /[^\x00-\x7f]/.test(url)) return { kind: "tooLong" };
  return { kind: "url", url };
}

/** Text instead of a code when there is none (plan 008, 2.5). */
export function qrHint(kind: "localhost" | "tooLong"): string {
  return kind === "localhost"
    ? "Mit localhost lässt sich kein Code für andere Geräte erzeugen. Öffne die Seite über die Netzwerkadresse dieses Rechners, damit der QR-Code funktioniert."
    : "Die Adresse ist für den QR-Code zu lang. Nutze den Link.";
}
