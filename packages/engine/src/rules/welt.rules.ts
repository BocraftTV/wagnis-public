import type { RuleConfig } from "../types.js";
import { defaultCardRules, defaultFortifyMoves, defaultFortifyReach } from "./defaults.js";

/**
 * Rule values of the world map (42 territories). 2 players are dealt 14 territories each plus 14 neutral ones;
 * every start army count is at least ceil(42 / owners), so each territory starts with an army.
 */
export const weltRules: RuleConfig = {
  startArmies: { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 },
  minReinforcement: 3,
  territoryDivisor: 3,
  initialPlacement: "auto",
  fortifyReach: defaultFortifyReach,
  fortifyMoves: defaultFortifyMoves,
  cards: defaultCardRules,
  victoryMode: "missions",
};
