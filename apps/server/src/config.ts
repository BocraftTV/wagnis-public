export interface Config {
  port: number;
  createCode: string;
  dbPath: string;
  trustProxyHeader: string | undefined;
  /** Origin (scheme, host, port) the clients should put into the lobby QR code; public, never a secret. */
  publicUrl: string | undefined;
}

export class ConfigError extends Error {}

/**
 * Normalises WAGNIS_PUBLIC_URL to its origin. Only http(s) with a host; no credentials, path, query or fragment.
 * Returns undefined when the value is not a valid address (the caller reports it without the value).
 */
function parsePublicUrl(raw: string): string | undefined {
  if (raw.includes("?") || raw.includes("#")) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.hostname === "" || url.username !== "" || url.password !== "") return undefined;
  if (url.pathname !== "/") return undefined;
  return url.origin;
}

/** Reads configuration from environment variables. Error messages never contain values. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const createCode = env["WAGNIS_CREATE_CODE"];
  if (createCode === undefined || createCode.length < 8) {
    throw new ConfigError("WAGNIS_CREATE_CODE must be set and at least 8 characters long");
  }
  const rawPort = env["PORT"];
  const port = rawPort === undefined || rawPort === "" ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError("PORT must be an integer between 0 and 65535");
  }
  const rawPublicUrl = env["WAGNIS_PUBLIC_URL"]?.trim();
  let publicUrl: string | undefined;
  if (rawPublicUrl) {
    publicUrl = parsePublicUrl(rawPublicUrl);
    if (publicUrl === undefined) {
      throw new ConfigError(
        "WAGNIS_PUBLIC_URL must be an http(s) address with host and optional port, without credentials, path, query or fragment",
      );
    }
  }
  return {
    port,
    createCode,
    dbPath: env["WAGNIS_DB_PATH"] || "./data/wagnis.db",
    trustProxyHeader: env["TRUST_PROXY_HEADER"]?.trim().toLowerCase() || undefined,
    publicUrl,
  };
}
