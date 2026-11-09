// Mission texts and the end-of-game resolution. Presentation only: whether a mission is fulfilled, who
// wins and why is decided by the server; this turns the delivered data into German sentences.
import type { GameViewMessage } from "@wagnis/shared";

export type Mission = NonNullable<GameViewMessage["secret"]["mission"]>;
export type Resolution = NonNullable<GameViewMessage["missions"]>;

export interface MissionContext {
  continentName: (id: string) => string;
  playerName: (id: string) => string;
}

/** "A", "A und B", "A, B und C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
}

function continentPart(ids: string[], extra: number, ctx: MissionContext): string {
  const parts: string[] = [];
  if (ids.length > 0) {
    const names = joinNames(ids.map(ctx.continentName));
    parts.push(ids.length === 1 ? `den Kontinent ${names}` : `die Kontinente ${names}`);
  }
  if (extra > 0) {
    parts.push(
      extra === 1
        ? `einen ${ids.length > 0 ? "weiteren " : ""}beliebigen Kontinent`
        : `${extra} ${ids.length > 0 ? "weitere " : ""}beliebige Kontinente`,
    );
  }
  return parts.join(" und dazu ");
}

export function missionText(mission: Mission, ctx: MissionContext): string {
  switch (mission.type) {
    case "conquerContinents":
      return `Halte ${continentPart(mission.continentIds, mission.extraContinents, ctx)} vollständig`;
    case "holdTerritories": {
      const what = mission.count === 1 ? "1 Gebiet" : `${mission.count} Gebiete`;
      if (mission.minArmies <= 1) return `Halte mindestens ${what}`;
      return mission.count === 1
        ? `Halte mindestens ${what} mit ${mission.minArmies} oder mehr Armeen`
        : `Halte mindestens ${what} mit je ${mission.minArmies} oder mehr Armeen`;
    }
    case "eliminatePlayer":
      return `Schalte ${ctx.playerName(mission.targetPlayerId)} aus`;
    case "connectedRealm":
      return `Halte mindestens ${mission.count} Gebiete, die ohne Lücke zusammenhängen`;
    case "blitzkrieg":
      return `Erobere in einem einzigen Zug ${mission.count} Gebiete`;
  }
}

/**
 * The self-target case (question 22) is recognised from the original mission alone: an elimination
 * mission whose target is the player of this row. There is no extra field in the state or the view.
 */
export function isSelfTarget(playerId: string, original: Mission | null): boolean {
  return (
    original !== null && original.type === "eliminatePlayer" && original.targetPlayerId === playerId
  );
}

export interface ResolutionRow {
  playerId: string;
  /** The mission the player held at the end. */
  current: string;
  /** Only if the mission was replaced: the one dealt at the start, worded for the self-target case. */
  original: string | null;
  /** Only with the mission draft: the mission put away face down. */
  discarded: string | null;
}

/**
 * One row per player in seat order, only when the view carries the resolution (`missions` is set after
 * the game; never before, and never in "domination"). The replacement is marked by `originalMission`.
 */
export function resolutionRows(
  missions: GameViewMessage["missions"],
  playerOrder: string[],
  me: string,
  ctx: MissionContext,
): ResolutionRow[] | null {
  if (!missions) return null;
  const rows: ResolutionRow[] = [];
  for (const playerId of playerOrder) {
    const entry = missions[playerId];
    if (!entry) continue;
    let original: string | null = null;
    if (entry.originalMission) {
      original = isSelfTarget(playerId, entry.originalMission)
        ? playerId === me
          ? "du solltest dich selbst ausschalten"
          : `${ctx.playerName(playerId)} sollte sich selbst ausschalten`
        : missionText(entry.originalMission, ctx);
    }
    rows.push({
      playerId,
      current: missionText(entry.mission, ctx),
      original,
      discarded: entry.discarded ? missionText(entry.discarded, ctx) : null,
    });
  }
  return rows;
}

/** Headline reason for the end-of-game banner, from the delivered `winReason`. */
export function winReasonText(reason: GameViewMessage["winReason"]): string | null {
  if (reason === "lastPlayer") return "als letzter verbliebener Spieler";
  if (reason === "mission") return "durch Erfüllen der Mission";
  return null;
}

export type MissionProgress = NonNullable<GameViewMessage["secret"]["missionProgress"]>;

/**
 * "Eroberungen in diesem Zug: 4 von 6" / "Größte zusammenhängende Gruppe: 11 von 15". The numbers come ready from
 * the view (`secret.missionProgress`); the client works out nothing (plan 013, question 48).
 */
export function progressText(
  mission: Mission | null,
  progress: MissionProgress | null,
): string | null {
  if (!mission || !progress) return null;
  if (mission.type === "blitzkrieg") {
    return `Eroberungen in diesem Zug: ${progress.current} von ${progress.target}`;
  }
  if (mission.type === "connectedRealm") {
    return `Größte zusammenhängende Gruppe: ${progress.current} von ${progress.target}`;
  }
  return null;
}

/** The banner for the hold-to-win option: the public hint, and the own marker as a reminder (plan 013, question 46). */
export function victoryPendingText(anyPending: boolean, ownPending: boolean): string | null {
  if (ownPending) return "Halte deine Mission bis zu deinem nächsten Zug.";
  if (anyPending) return "Jemand steht kurz vor dem Sieg.";
  return null;
}

/** "Warte auf die anderen (3 von 5 haben gewählt)", from the public list of who has chosen. */
export function choiceWaitText(chosen: number, total: number): string {
  return `Warte auf die anderen (${chosen} von ${total} haben gewählt)`;
}
