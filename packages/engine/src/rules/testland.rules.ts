import type { RuleConfig } from "../types.js";
import { defaultCardRules, defaultFortifyReach } from "./defaults.js";

export const testlandRules: RuleConfig = {
  startArmies: { 2: 8, 3: 7, 4: 6, 5: 5, 6: 4 },
  minReinforcement: 3,
  territoryDivisor: 3,
  initialPlacement: "auto",
  fortifyReach: defaultFortifyReach,
  cards: defaultCardRules,
  victoryMode: "missions",
};
