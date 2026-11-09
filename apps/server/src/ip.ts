import type { IncomingHttpHeaders } from "node:http";

/**
 * Client IP for rate limiting. With a configured proxy header (e.g. cf-connecting-ip) its first
 * value is used, otherwise the socket address. Only enable the header behind a trusted proxy.
 */
export function clientIp(
  headers: IncomingHttpHeaders,
  socketIp: string,
  trustProxyHeader: string | undefined,
): string {
  if (trustProxyHeader) {
    const raw = headers[trustProxyHeader];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
    if (value) return value;
  }
  return socketIp;
}
