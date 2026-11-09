import type { CardRules, RuleConfig } from "../types.js";

export const defaultFortifyReach: RuleConfig["fortifyReach"] = "connected";

/** One fortify move per turn (rules.md 5.3, question 38). */
export const defaultFortifyMoves: RuleConfig["fortifyMoves"] = 1;

export const defaultCardRules: CardRules = {
  jokers: 2,
  tradeValues: { infantry: 4, cavalry: 6, artillery: 8, mixed: 10 },
  territoryBonus: 2,
  mustTradeAt: 5,
};
