import { describe, expect, it } from "vitest";
import { qrHint, qrTarget } from "./target.js";

const ID = "K7M2XQ";
const at = (pageUrl: string, publicUrl: string | null = null, roomId = ID) =>
  qrTarget({ pageUrl, publicUrl, roomId });

describe("qrTarget", () => {
  it("uses publicUrl whatever the page is", () => {
    expect(at("http://localhost:5173/r/K7M2XQ", "http://192.0.2.10:3000")).toEqual({
      kind: "url",
      url: "http://192.0.2.10:3000/r/K7M2XQ",
    });
    expect(at("http://192.0.2.99/x", "https://example.test")).toEqual({
      kind: "url",
      url: "https://example.test/r/K7M2XQ",
    });
  });
  it("uses only the origin of the page without publicUrl", () => {
    expect(at("http://192.0.2.10:3000/lobby?x=1#y")).toEqual({
      kind: "url",
      url: "http://192.0.2.10:3000/r/K7M2XQ",
    });
    expect(at("https://example.test/r/K7M2XQ?token=abc#t")).toEqual({
      kind: "url",
      url: "https://example.test/r/K7M2XQ",
    });
  });
  it("asks for another address on localhost-like hosts and other schemes", () => {
    for (const u of [
      "http://localhost:5173/",
      "http://127.0.0.1:3000/",
      "http://127.0.0.5/",
      "http://[::1]:3000/",
      "http://0.0.0.0:3000/",
      "http://foo.localhost/",
      "http://LOCALHOST/",
      "ftp://192.0.2.10/",
      "file:///tmp/x",
      "not a url",
    ]) {
      expect(at(u), u).toEqual({ kind: "localhost" });
    }
  });
  it("writes the room code without formatting and never puts a token or name in the address", () => {
    const r = at("http://192.0.2.10:3000/", null, "K7M-2XQ");
    expect(r).toEqual({ kind: "url", url: "http://192.0.2.10:3000/r/K7M2XQ" });
    const withSecrets = at("http://user:pw@192.0.2.10:3000/r/K7M2XQ?token=geheim#frag");
    expect(JSON.stringify(withSecrets)).not.toMatch(/geheim|pw|user|token|frag/);
  });
  it("falls back when the address is too long or not ASCII", () => {
    expect(at(`http://${"a".repeat(220)}.test/`)).toEqual({ kind: "tooLong" });
    expect(at("http://192.0.2.10/", "http://ä.test")).toEqual({ kind: "tooLong" });
  });
  it("has hint texts", () => {
    expect(qrHint("localhost")).toContain("localhost");
    expect(qrHint("tooLong")).toContain("zu lang");
  });
});
