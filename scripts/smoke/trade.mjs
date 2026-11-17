// Trade section and the attack on a neutral territory.
import { join } from "node:path";
import Database from "better-sqlite3";
import { tmp, createCode, check, getMap, Client, startServer, stopServer, until } from "./lib.mjs";

/**
 * Trade section: the card draw is random in a live game, so the stand is prepared for determinism: stop the
 * server, give the active player five cards in the saved state (3 x infantry, cavalry, joker; this also
 * covers the restart), start the server again and play the forced trade over WebSocket.
 */
export async function tradeSection({ port, base, roomId, tokens, old, names }) {
  console.log("== trade: stop server, prepare a hand of 5 for the active player, restart");
  old.anna.ws.close();
  old.ben.ws.close();
  await stopServer();
  const db = new Database(join(tmp, "smoke.db"));
  const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId);
  const state = JSON.parse(row.state_json);
  const terr = getMap("testland").territories;
  const prepared = [0, 3, 6, 1].map((i) => `card-${terr[i].id}`).concat("card-joker-1");
  const activeId = state.activePlayerId;
  const otherId = state.playerOrder.find((id) => id !== activeId);
  const { secret } = state;
  const drop = (ids) => ids.filter((id) => !prepared.includes(id));
  secret.deck = drop(secret.deck);
  secret.discard = drop(secret.discard);
  for (const id of state.playerOrder) secret.hand[id] = drop(secret.hand[id] ?? []);
  secret.hand[activeId] = [...secret.hand[activeId], ...prepared];
  const handSize = secret.hand[activeId].length;
  // Missions must not end the game by accident in the sections below: the hardest mission for the active player.
  const unreachable = {
    type: "conquerContinents",
    continentIds: ["nordreich"],
    extraContinents: 1,
  };
  secret.mission[activeId] = unreachable;
  secret.originalMission[activeId] = unreachable;
  secret.missionReplaced[activeId] = false;
  const prep = prepareNeutralAttack(state, activeId, otherId);
  db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
  db.close();
  await startServer(port, base);

  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  const anna = new Client("Anna", wsUrl);
  const ben = new Client("Ben", wsUrl);
  await Promise.all([anna.ready, ben.ready]);
  anna.send({ type: "hello", roomId, token: tokens.anna });
  ben.send({ type: "hello", roomId, token: tokens.ben });
  const byId = { [tokens.annaId]: anna, [tokens.benId]: ben };
  const owner = byId[activeId];
  const observer = byId[otherId];
  await Promise.all([
    owner.until((v) => v.game?.secret.hand.length === handSize, "restored hand"),
    observer.until((v) => v.game?.handCounts[activeId] === handSize, "restored count"),
  ]);
  check(true, `server restarted, ${names[activeId]} has ${handSize} cards`);
  const mine = owner.view.game;
  check(
    mine.secret.hand.every(
      (c) =>
        c.bonusEligible ===
        (c.territoryId !== null && mine.territories[c.territoryId]?.ownerId === activeId),
    ),
    "bonusEligible on every own card: true exactly for cards of own territories (joker false)",
  );
  check(
    observer.view.game.secret.hand.every((c) => typeof c.bonusEligible === "boolean"),
    "bonusEligible is part of the hand schema for the other player too (their own hand only)",
  );
  check(mine.secret.mustTrade === true, "mustTrade is set for the owner with 5+ cards");
  check(
    observer.view.game.secret.mustTrade === false &&
      !observer.view.game.secret.hand.some((c) => prepared.includes(c.id)),
    "the other player sees none of the prepared cards and no mustTrade",
  );
  check(
    mine.secret.suggestedSets.length >= 1 &&
      mine.secret.suggestedSets.length <= 4 &&
      mine.secret.suggestedSets.every((x, i, a) => i === 0 || a[i - 1].value > x.value),
    `suggestedSets: ${mine.secret.suggestedSets.map((x) => x.value).join(", ")} (at most 4, descending)`,
  );

  // forced trade blocks placing and ending the phase
  const target = Object.entries(mine.territories).find(([, t]) => t.ownerId === activeId)[0];
  const errorsBefore = owner.errors.length;
  owner.send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
  owner.send({ type: "action", action: { type: "endPhase" } });
  await until(() => owner.errors.length >= errorsBefore + 2, "two MUST_TRADE answers");
  check(
    owner.errors.slice(errorsBefore).every((e) => e.code === "MUST_TRADE"),
    "placeArmies and endPhase are answered with MUST_TRADE",
  );
  owner.send({
    type: "action",
    action: { type: "tradeCards", cardIds: [prepared[0], prepared[1], prepared[2]].slice(0, 2) },
  });
  await until(() => owner.errors.length >= errorsBefore + 3, "BAD_MESSAGE for two cards");
  check(owner.errors.at(-1).code === "BAD_MESSAGE", "a trade with two card ids is rejected");

  // trade the best suggestion
  const best = mine.secret.suggestedSets[0];
  const left = mine.reinforcementsLeft;
  const version = owner.view.version;
  owner.send({
    type: "action",
    action: {
      type: "tradeCards",
      cardIds: best.cardIds,
      ...(best.bonusTerritoryId ? { bonusTerritoryId: best.bonusTerritoryId } : {}),
    },
  });
  const [vo, vb] = await Promise.all([
    owner.until((v) => v.game.lastTrade !== null, "trade seen by owner"),
    observer.until((v) => v.game.lastTrade !== null, "trade seen by the other player"),
  ]);
  const tr = vo.game.lastTrade;
  check(
    JSON.stringify(tr) === JSON.stringify(vb.game.lastTrade) && tr.armies === best.value,
    `both players see the trade (seq ${tr.seq}, ${tr.armies} armies, ${tr.cards.length} cards)`,
  );
  check(
    vo.game.reinforcementsLeft === left + best.value && vo.version === version + 1,
    `reinforcements ${left} -> ${vo.game.reinforcementsLeft}, one version bump`,
  );
  check(
    vo.game.secret.hand.length === handSize - 3 &&
      vb.game.handCounts[activeId] === handSize - 3 &&
      vo.game.discardCount === vb.game.discardCount,
    `hand ${handSize} -> ${vo.game.secret.hand.length}, discard pile ${vo.game.discardCount} (public count)`,
  );
  // cards of the other hand and the pile never reach the other player: only the traded ones are public
  const publicIds = new Set(tr.cards.map((c) => c.id));
  const leaked = vo.game.secret.hand
    .map((c) => c.id)
    .filter((id) => observer.raw.join("\n").includes(id));
  check(
    leaked.length === 0 && [...publicIds].every((id) => mine.secret.hand.some((c) => c.id === id)),
    "cards kept in hand never appeared on the other player's connection; only the traded ones are public",
  );
  // placing works again with the traded armies
  owner.send({ type: "action", action: { type: "placeArmies", territoryId: target, count: 1 } });
  await owner.until(
    (v) => v.game.reinforcementsLeft === vo.game.reinforcementsLeft - 1,
    "placing again",
  );
  check(true, "placing works again after the trade");

  const wire = [...anna.raw, ...ben.raw].join("\n");
  check(
    ![createCode, tokens.anna, tokens.ben, "tokenHash", "token_hash", "tradeSeq", '"deck"'].some(
      (x) => wire.includes(x),
    ),
    "no code, token, tradeSeq or deck on the wire after the restart",
  );
  const unexpected = [...anna.errors, ...ben.errors].filter(
    (e) => e.code !== "MUST_TRADE" && e.code !== "BAD_MESSAGE",
  );
  check(unexpected.length === 0, "no unexpected server errors in the trade section");
  await neutralSection({ owner, observer, activeId, prep });
  check(
    [...anna.errors, ...ben.errors].every(
      (e) => e.code === "MUST_TRADE" || e.code === "BAD_MESSAGE",
    ),
    "no unexpected server errors in the neutral section",
  );
  anna.ws.close();
  ben.ws.close();
}

/**
 * Prepares (in the saved state) a territory of the active player next to a neutral territory with 5+ armies.
 * Never takes the other player's last territory.
 */
function prepareNeutralAttack(state, activeId, otherId) {
  const map = getMap("testland");
  const ids = Object.keys(state.territories);
  const ownedBy = (id) => ids.filter((t) => state.territories[t].ownerId === id);
  let to = ids.find((t) => state.territories[t].ownerId === null);
  if (!to) {
    const give = ownedBy(otherId);
    if (give.length < 2) throw new Error("no neutral territory left to attack");
    to = give[0];
    state.territories[to].ownerId = null;
  }
  const neighbors = map.territories.find((x) => x.id === to).neighbors;
  const from =
    neighbors.find((n) => state.territories[n].ownerId === activeId) ??
    neighbors.find((n) => state.territories[n].ownerId === otherId && ownedBy(otherId).length > 1);
  if (!from) throw new Error("no territory next to the neutral one to attack from");
  state.territories[from].ownerId = activeId;
  state.territories[from].armies = Math.max(state.territories[from].armies, 5);
  return { from, to };
}

/** Attack on a neutral territory: the neutral defender is `null` and defends with maximum dice. */
async function neutralSection({ owner, observer, activeId, prep }) {
  console.log("== neutral: the active player attacks a neutral territory");
  const left = owner.view.game.reinforcementsLeft;
  if (left > 0) {
    owner.send({
      type: "action",
      action: { type: "placeArmies", territoryId: prep.from, count: left },
    });
    await owner.until((v) => v.game.reinforcementsLeft === 0, "placing everything");
  }
  owner.send({ type: "action", action: { type: "endPhase" } });
  await owner.until((v) => v.game.phase === "attack", "attack phase");
  const before = owner.view.game;
  const target = before.territories[prep.to];
  const neutralBefore = Object.values(before.territories).filter((t) => t.ownerId === null).length;
  check(target.ownerId === null, `${prep.to} is neutral before the attack`);
  const seq = before.lastCombat?.seq ?? 0;
  owner.send({
    type: "action",
    action: {
      type: "attack",
      from: prep.from,
      to: prep.to,
      dice: before.territories[prep.from].maxAttackDice,
    },
  });
  const [vo, vb] = await Promise.all([
    owner.until((v) => (v.game.lastCombat?.seq ?? 0) > seq, "combat seen by the owner"),
    observer.until((v) => (v.game.lastCombat?.seq ?? 0) > seq, "combat seen by the other player"),
  ]);
  const c = vo.game.lastCombat;
  check(
    c.defenderId === null && c.attackerId === activeId,
    "combat record: defenderId is null (Neutral), attacker is the active player",
  );
  check(
    JSON.stringify(c) === JSON.stringify(vb.game.lastCombat),
    "both players see the same neutral combat",
  );
  check(
    c.rolls[0].defenderDice.length === Math.min(2, target.armies),
    `Neutral defends with the maximum dice (${c.rolls[0].defenderDice.length} for ${target.armies} armies)`,
  );
  if (vo.game.pendingOccupation) {
    owner.send({
      type: "action",
      action: { type: "occupy", count: vo.game.pendingOccupation.max },
    });
    await owner.until((v) => v.game.pendingOccupation === null, "occupy");
  }
  const after = owner.view.game;
  const neutralAfter = Object.values(after.territories).filter((t) => t.ownerId === null).length;
  check(
    neutralAfter === neutralBefore - (c.summary.conquered ? 1 : 0) &&
      after.conqueredThisTurn === (c.summary.conquered || before.conqueredThisTurn) &&
      after.winnerId === null &&
      Object.keys(after.handCounts).length === 2,
    `conquering Neutral (${c.summary.conquered ? "yes" : "no"}): Neutral only loses territories; no winner, no neutral hand`,
  );
}
