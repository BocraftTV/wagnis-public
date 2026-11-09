import { describe, expect, it } from "vitest";
import { clearIdentity, loadIdentity, saveIdentity } from "./storage.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing = new Proxy({} as Storage, {
  get() {
    throw new Error("blocked");
  },
});

describe("identity storage", () => {
  it("stores one identity per room", () => {
    const s = memoryStorage();
    saveIdentity("AAAAAA", { playerId: "p1", token: "t1" }, s);
    saveIdentity("BBBBBB", { playerId: "p2", token: "t2" }, s);
    expect(loadIdentity("AAAAAA", s)).toEqual({ playerId: "p1", token: "t1" });
    expect(loadIdentity("BBBBBB", s)?.token).toBe("t2");
    clearIdentity("AAAAAA", s);
    expect(loadIdentity("AAAAAA", s)).toBeNull();
  });

  it("starts cleanly with empty, corrupt, or unavailable storage", () => {
    const s = memoryStorage();
    expect(loadIdentity("AAAAAA", s)).toBeNull();
    s.setItem("wagnis:room:AAAAAA", "{not json");
    expect(loadIdentity("AAAAAA", s)).toBeNull();
    s.setItem("wagnis:room:AAAAAA", JSON.stringify({ playerId: 1 }));
    expect(loadIdentity("AAAAAA", s)).toBeNull();
    expect(loadIdentity("AAAAAA", undefined)).toBeNull();
    expect(loadIdentity("AAAAAA", throwing)).toBeNull();
    expect(() => saveIdentity("AAAAAA", { playerId: "p", token: "t" }, throwing)).not.toThrow();
    expect(() => clearIdentity("AAAAAA", throwing)).not.toThrow();
  });
});
