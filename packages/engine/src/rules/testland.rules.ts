import type { RuleConfig } from "../types.js";
import { defaultCardRules, defaultFortifyMoves, defaultFortifyReach } from "./defaults.js";

export const testlandRules: RuleConfig = {
  startArmies: { 2: 8, 3: 7, 4: 6, 5: 5, 6: 4 },
  minReinforcement: 3,
  territoryDivisor: 3,
  initialPlacement: "auto",
  fortifyReach: defaultFortifyReach,
  fortifyMoves: defaultFortifyMoves,
  cards: defaultCardRules,
  victoryMode: "missions",
};
