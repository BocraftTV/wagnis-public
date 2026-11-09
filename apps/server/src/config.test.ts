import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("refuses a missing or short create code without revealing it", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ WAGNIS_CREATE_CODE: "short" })).toThrow(/at least 8/);
  });
  it("applies defaults", () => {
    expect(loadConfig({ WAGNIS_CREATE_CODE: "12345678" })).toEqual({
      port: 3000,
      createCode: "12345678",
      dbPath: "./data/wagnis.db",
      trustProxyHeader: undefined,
      publicUrl: undefined,
    });
  });
  it("reads port, db path and proxy header", () => {
    const c = loadConfig({
      WAGNIS_CREATE_CODE: "12345678",
      PORT: "8080",
      WAGNIS_DB_PATH: "x.db",
      TRUST_PROXY_HEADER: "CF-Connecting-IP",
    });
    expect(c.port).toBe(8080);
    expect(c.dbPath).toBe("x.db");
    expect(c.trustProxyHeader).toBe("cf-connecting-ip");
    expect(() => loadConfig({ WAGNIS_CREATE_CODE: "12345678", PORT: "abc" })).toThrow(ConfigError);
  });

  describe("WAGNIS_PUBLIC_URL", () => {
    const base = { WAGNIS_CREATE_CODE: "12345678" };
    const read = (v: string | undefined) =>
      loadConfig(v === undefined ? base : { ...base, WAGNIS_PUBLIC_URL: v }).publicUrl;

    it("is optional: unset, empty and blank mean not set", () => {
      expect(read(undefined)).toBeUndefined();
      expect(read("")).toBeUndefined();
      expect(read("   ")).toBeUndefined();
    });
    it("stores the origin", () => {
      expect(read("https://example.test")).toBe("https://example.test");
      expect(read("http://192.0.2.10:3000/")).toBe("http://192.0.2.10:3000");
      expect(read(" http://example.test:8080 ")).toBe("http://example.test:8080");
    });
    it("refuses anything but a plain http(s) origin, without echoing the value", () => {
      const bad = [
        "ftp://example.test",
        "example.test",
        "http://",
        "http://example.test/lobby",
        "http://user:pw@example.test",
        "http://example.test?x=1",
        "http://example.test/?x",
        "http://example.test#y",
        "http://example.test/#",
      ];
      for (const v of bad) {
        let message = "";
        try {
          read(v);
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          message = (err as Error).message;
        }
        expect(message, v).toMatch(/WAGNIS_PUBLIC_URL/);
        for (const part of ["example", "user", "pw", "lobby", "x=1", "ftp"]) {
          expect(message, `${v} leaks ${part}`).not.toContain(part);
        }
      }
    });
  });
});
