/** 31 characters: no I, L, O, 0, 1. */
export const ROOM_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_ID_LENGTH = 6;

/** Trim, upper-case, drop hyphens and whitespace. Does not validate. */
export function normalizeRoomId(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

export function isValidRoomId(id: string): boolean {
  return id.length === ROOM_ID_LENGTH && [...id].every((c) => ROOM_ID_ALPHABET.includes(c));
}

/** K7M2XQ -> K7M-2XQ. Returns the input unchanged if it is not a valid id. */
export function formatRoomId(id: string): string {
  return isValidRoomId(id) ? `${id.slice(0, 3)}-${id.slice(3)}` : id;
}
