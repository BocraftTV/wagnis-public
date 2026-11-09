// Texts for the map's hint strip and the action field: territory name, owner and armies, nothing else.

export function armiesText(armies: number | null): string {
  if (armies === null) return "Armeen unbekannt (Nebel)";
  return armies === 1 ? "1 Armee" : `${armies} Armeen`;
}

/** "Name · Owner · 5 Armeen" for the last territory the player tapped. */
export function territoryHint(name: string, owner: string, armies: number | null): string {
  return `${name} · ${owner} · ${armiesText(armies)}`;
}
