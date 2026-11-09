import type { MapDefinition } from "./types.js";

export type MapValidation = { ok: true } | { ok: false; errors: string[] };

export function validateMap(map: MapDefinition): MapValidation {
  const errors: string[] = [];
  const territoryIds = new Set<string>();
  for (const t of map.territories) {
    if (territoryIds.has(t.id)) errors.push(`duplicate territory id: ${t.id}`);
    territoryIds.add(t.id);
  }
  const continentIds = new Set<string>();
  for (const c of map.continents) {
    if (continentIds.has(c.id)) errors.push(`duplicate continent id: ${c.id}`);
    continentIds.add(c.id);
  }

  const byId = new Map(map.territories.map((t) => [t.id, t]));
  const usedContinents = new Set<string>();
  for (const t of map.territories) {
    if (!continentIds.has(t.continentId)) {
      errors.push(`territory ${t.id} references unknown continent ${t.continentId}`);
    }
    usedContinents.add(t.continentId);
    for (const n of t.neighbors) {
      if (n === t.id) {
        errors.push(`territory ${t.id} lists itself as neighbor`);
      } else if (!byId.has(n)) {
        errors.push(`territory ${t.id} references unknown neighbor ${n}`);
      } else if (!byId.get(n)!.neighbors.includes(t.id)) {
        errors.push(`neighbor relation ${t.id} -> ${n} is not symmetric`);
      }
    }
  }
  const seenRoutes = new Set<string>();
  for (const [a, b] of map.seaRoutes) {
    const key = [a, b].sort().join("|");
    if (seenRoutes.has(key)) errors.push(`duplicate sea route ${a} - ${b}`);
    seenRoutes.add(key);
    if (!byId.get(a)?.neighbors.includes(b))
      errors.push(`sea route ${a} - ${b} is not a neighbour pair`);
  }
  for (const c of map.continents) {
    if (!usedContinents.has(c.id)) errors.push(`continent ${c.id} has no territories`);
  }

  const first = map.territories[0];
  if (first) {
    const seen = new Set<string>([first.id]);
    const queue = [first.id];
    while (queue.length > 0) {
      const current = byId.get(queue.pop()!);
      for (const n of current?.neighbors ?? []) {
        if (byId.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (seen.size !== byId.size) errors.push("territory graph is not connected");
  } else {
    errors.push("map has no territories");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
