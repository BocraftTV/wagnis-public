/**
 * Format version of the stored `GameState`, a consecutive number. Up to version 4 it was the phase in which the
 * format appeared; phase 5 needed no new format, phase 6a did (`removedPlayerIds`), so from version 5 on the
 * number simply counts formats. Internal, never in a view. Every new version needs one migration step in
 * `migrate.ts` (rules.md 1.5).
 */
export const STATE_VERSION = 5;
