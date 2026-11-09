import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Rng } from "@wagnis/engine";
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from "@wagnis/shared";

export const cryptoRng: Rng = { int: (maxExclusive) => randomInt(maxExclusive) };

export const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Compares two secrets by hashing both, then timingSafeEqual. */
export function secretsEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return sha256(token).toString("hex");
}

export function generateRoomId(exists: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = "";
    for (let i = 0; i < ROOM_ID_LENGTH; i++)
      id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
    if (!exists(id)) return id;
  }
  throw new Error("could not allocate a room id");
}
