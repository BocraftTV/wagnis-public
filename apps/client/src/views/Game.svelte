<script lang="ts">
  import type { GameViewMessage, RoomView } from "@wagnis/shared";
  import type { GameConnection } from "../lib/connection.svelte.js";
  import {
    effectiveDice,
    eliminatedPlayers,
    emptySelection,
    pruneSelection,
    selectionAfterTap,
    targetsFrom,
  } from "../lib/attack.js";
  import type { Selection } from "../lib/attack.js";
  import {
    effectiveMove,
    fortifyOrigins,
    isSendLocked,
    movesDoneChanged,
    movesDoneOf,
    fortifyTargets,
    pruneFortifySelection,
    selectionAfterFortifyTap,
  } from "../lib/fortify.js";
  import type { SendLock } from "../lib/fortify.js";
  import { planPlayback, playbackGate } from "../lib/dice.js";
  import type { Playback } from "../lib/dice.js";
  import AttackBar from "../components/AttackBar.svelte";
  import CombatField from "../components/CombatField.svelte";
  import FortifyBar from "../components/FortifyBar.svelte";
  import GameOver from "../components/GameOver.svelte";
  import HandPanel from "../components/HandPanel.svelte";
  import MapCanvas from "../components/MapCanvas.svelte";
  import MissionChoice from "../components/MissionChoice.svelte";
  import OccupyBar from "../components/OccupyBar.svelte";
  import PlayerLegend from "../components/PlayerLegend.svelte";
  import StatusBar from "../components/StatusBar.svelte";
  import TradeNote from "../components/TradeNote.svelte";
  import MissionSheet from "../components/MissionSheet.svelte";
  import TradeDialog from "../components/TradeDialog.svelte";
  import { seenTrades, tradeLine } from "../lib/cards.js";
  import {
    missionText,
    progressText,
    resolutionRows,
    victoryPendingText,
    winReasonText,
  } from "../lib/missions.js";
  import { scoreRows } from "../lib/rounds.js";
  import { eventText, eventTitle } from "../lib/events.js";
  import { mateIds, teamScoreRows, winningTeams } from "../lib/teams.js";
  import { armiesText } from "../lib/hint.js";
  import { nameWithMark } from "../lib/host.js";
  import { territoryMarks } from "../lib/mark.js";
  import { ownerColor, ownerName } from "../lib/owner.js";
  import { mapData } from "../maps/index.js";

  let {
    view,
    game,
    conn,
  }: { view: RoomView; game: GameViewMessage; conn: GameConnection } = $props();

  const data = $derived(mapData(game.mapId));
  const me = $derived(view.you.playerId);
  const myTurn = $derived(game.activePlayerId === me);
  const mustTrade = $derived(game.secret.mustTrade);
  // Placing is greyed out while a trade is required (display only; the server also answers MUST_TRADE).
  const placing = $derived(myTurn && game.phase === "reinforce" && !mustTrade);
  // `null` is the neutral owner (2 players): label "Neutral", own color token, no list entry, no turn.
  const playerName = (id: string | null) => ownerName(id, view.players);
  const colorOf = (id: string | null) => ownerColor(id, view.players);

  const finished = $derived(game.winnerId !== null);
  const canTrade = $derived(
    myTurn && game.phase === "reinforce" && !finished && game.secret.hand.length >= 3,
  );
  const pending = $derived(game.pendingOccupation);
  const attacking = $derived(myTurn && game.phase === "attack" && !pending && !finished);
  const out = $derived(eliminatedPlayers(game));
  const fortifying = $derived(myTurn && game.phase === "fortify" && !finished);

  // Team mates (display only): their territories are no attack targets, and their hands are shown.
  const mates = $derived(mateIds(game.teams, me));
  // On a tie after the round limit two teams win together (rules.md 13): every team with a winner is marked.
  const winnerTeams = $derived(winningTeams(game.teams, game.winnerIds, game.winnerTeamId));
  const teamRows = $derived(teamScoreRows(game.teamScores, winnerTeams));
  const neighbors = $derived(
    data ? Object.fromEntries(data.map.territories.map((t) => [t.id, t.neighbors])) : {},
  );
  let selection = $state<Selection>(emptySelection);
  let chosenDice = $state<number | null>(null);
  const targets = $derived(
    attacking ? targetsFrom(neighbors, game.territories, me, selection.from, mates) : [],
  );
  const moveTargets = $derived(fortifying ? fortifyTargets(game.fortify, selection.from) : []);
  const moveOrigins = $derived(
    fortifying ? fortifyOrigins(game.fortify, game.territories, me) : [],
  );
  let chosenMove = $state<number | null>(null);
  const maxMove = $derived(selection.from ? (game.territories[selection.from]?.maxMove ?? 0) : 0);
  const moveCount = $derived(effectiveMove(chosenMove, maxMove));
  const maxDice = $derived(
    selection.from ? (game.territories[selection.from]?.maxAttackDice ?? 0) : 0,
  );
  const dice = $derived(effectiveDice(chosenDice, maxDice));
  const diceOptions = $derived(Array.from({ length: maxDice }, (_, i) => i + 1));

  // Keep the selection in step with the latest snapshot (a conquest, lost armies, a new turn).
  $effect(() => {
    const next = attacking
      ? pruneSelection(selection, game.territories, me)
      : fortifying
        ? pruneFortifySelection(selection, game.fortify, game.territories, me)
        : emptySelection;
    if (next.from !== selection.from || next.to !== selection.to) selection = next;
  });

  // Ring marks for the map, from the same rules the taps use.
  const marks = $derived(
    data
      ? territoryMarks(
          {
            mode: placing ? "place" : fortifying ? "fortify" : attacking ? "attack" : null,
            me,
            territories: game.territories,
            selection,
            targets,
            moveTargets,
            moveOrigins,
          },
          data.map.territories.map((t) => t.id),
        )
      : {},
  );

  function tap(territoryId: string) {
    const t = game.territories[territoryId];
    if (placing) {
      if (t?.ownerId === me) conn.sendAction({ type: "placeArmies", territoryId, count: 1 });
      return;
    }
    if (fortifying) {
      const next = selectionAfterFortifyTap(selection, territoryId, game.fortify, game.territories, me);
      if (next.from !== selection.from) chosenMove = null;
      selection = next;
      return;
    }
    if (!attacking) return;
    const next = selectionAfterTap(selection, territoryId, game.territories, me, targets);
    if (next.from !== selection.from) chosenDice = null;
    selection = next;
  }

  function attack() {
    if (selection.from && selection.to && dice > 0) {
      conn.sendAction({ type: "attack", from: selection.from, to: selection.to, dice });
    }
  }
  function blitz() {
    if (selection.from && selection.to) {
      conn.sendAction({ type: "blitz", from: selection.from, to: selection.to });
    }
  }

  // A duplicated `fortify` would be a valid second move (two-move setting): lock the button from sending
  // until the next snapshot or an error arrives. Display only, the server still decides.
  let moveLock = $state<SendLock | null>(null);
  const moveLocked = $derived(isSendLocked(moveLock, view.version, conn.noticeCount));

  // A move changes the counter: drop the old origin/target pair so a stray tap cannot use the second move.
  let lastMovesDone: number | null = null;
  $effect(() => {
    const changed = movesDoneChanged(lastMovesDone, game.fortify);
    lastMovesDone = fortifying ? movesDoneOf(game.fortify) : null;
    if (changed && fortifying) {
      selection = emptySelection;
      chosenMove = null;
    }
  });

  function fortify() {
    if (moveLocked) return;
    if (selection.from && selection.to && moveCount > 0) {
      moveLock = { version: view.version, errors: conn.noticeCount };
      conn.sendAction({ type: "fortify", from: selection.from, to: selection.to, count: moveCount });
    }
  }

  // Trade dialog: opened by the player, and by itself when the view says a trade is required.
  let tradeOpen = $state(false);
  let wasMustTrade = false;
  $effect(() => {
    if (mustTrade && !wasMustTrade) tradeOpen = true;
    wasMustTrade = mustTrade;
    if (!canTrade) tradeOpen = false;
  });
  function trade(cardIds: string[], bonusTerritoryId: string | undefined) {
    conn.sendAction({
      type: "tradeCards",
      cardIds,
      ...(bonusTerritoryId ? { bonusTerritoryId } : {}),
    });
    tradeOpen = false;
  }

  // Trade field: every trade (`seq`) is shown once per page load, to all players, until tapped away.
  let shownTrade = $state.raw<NonNullable<GameViewMessage["lastTrade"]> | null>(null);
  $effect(() => {
    const tr = game.lastTrade;
    if (!tr) shownTrade = null;
    else if (seenTrades.markIfNew(view.roomId, view.gameNo, tr.seq)) shownTrade = tr;
  });

  // Move-in stepper: range and default come from the view.
  let occupyCount = $state(0);
  const pendingKey = $derived(
    pending ? `${pending.from}>${pending.to}:${pending.min}:${pending.max}` : "",
  );
  $effect(() => {
    if (pendingKey && pending) occupyCount = pending.max;
  });
  const occupying = $derived(myTurn && pending !== null && !finished);

  // Combat result field: every combat (`seq`) is shown once per page load, to all players. The dice animation is
  // decoration on top (plan 008): the gate decides per snapshot, the text is there from the start. The field closes
  // itself and ends the animation (CombatField).
  const FLASH_MS = 1500;
  const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let shown = $state.raw<NonNullable<GameViewMessage["lastCombat"]> | null>(null);
  let playback = $state.raw<Playback | null>(null);
  let flash = $state.raw<{ from: string; to: string } | null>(null);
  $effect(() => {
    const c = game.lastCombat;
    const decision = playbackGate.decide({
      roomId: view.roomId,
      gameNo: view.gameNo,
      combat: c,
      reducedMotion: reducedMotion(),
    });
    if (c && decision !== "none") {
      shown = c;
      // a new combat replaces a running playback at once
      playback = decision === "animate" ? planPlayback(c, { reducedMotion: false }) : null;
      flash = { from: c.from, to: c.to };
    }
  });
  $effect(() => {
    if (!flash) return;
    const h = setTimeout(() => (flash = null), FLASH_MS);
    return () => clearTimeout(h);
  });
  const flashIds = $derived(flash ? [flash.from, flash.to] : []);
  const territoryName = (id: string) => data?.map.territories.find((t) => t.id === id)?.name ?? id;
  // Name, owner and armies in text: the action field names both territories even if the map shows only one.
  function describe(id: string): string {
    const st = game.territories[id];
    return st ? `${territoryName(id)} (${playerName(st.ownerId)}, ${armiesText(st.armies)})` : territoryName(id);
  }
  const missionCtx = {
    continentName: (id: string) => data?.map.continents.find((c) => c.id === id)?.name ?? id,
    playerName: (id: string) => nameWithMark(playerName(id), game.removedPlayerIds.includes(id)),
  };

  // End of game: the reason and, once the view carries `missions`, every player's mission.
  const reasonText = $derived(winReasonText(game.winReason));
  const scores = $derived(scoreRows(game.scores, game.winnerIds));
  const resolution = $derived(resolutionRows(game.missions, game.playerOrder, me, missionCtx));

  // Plan 013: progress of the own mission and the hold-to-win hint; both come ready from the view.
  const progress = $derived(progressText(game.secret.mission, game.secret.missionProgress));
  const pendingBanner = $derived(
    finished ? null : victoryPendingText(game.victoryPending, game.secret.victoryPending),
  );

  // The own mission is shown on request only (others look over the table); `secret.mission` is `null` in "domination".
  let missionOpen = $state(false);
  const myMission = $derived(game.secret.mission);
  $effect(() => {
    if (!myMission || finished) missionOpen = false;
  });
</script>

{#if game.phase === "missionChoice"}
  <MissionChoice {view} {game} {conn} ctx={missionCtx} />
  {#if conn.notice}<div class="toast" role="alert">{conn.notice}</div>{/if}
{:else}
<div class="game">
  <StatusBar
    {game}
    {myTurn}
    {finished}
    showMission={!!myMission && !finished}
    endDisabled={!myTurn || pending !== null || (game.phase === "reinforce" && mustTrade)}
    {playerName}
    {colorOf}
    onmission={() => (missionOpen = true)}
    onendphase={() => conn.sendAction({ type: "endPhase" })}
    eventLine={game.worldEvent && !finished
      ? { title: eventTitle(game.worldEvent.kind), text: eventText(game.worldEvent, missionCtx) }
      : null}
    {pendingBanner}
    progress={finished ? null : progress}
    trade={myTurn && game.phase === "reinforce" && mustTrade && !finished
      ? "must"
      : canTrade
        ? "may"
        : null}
    onopentrade={() => (tradeOpen = true)}
  />


  <GameOver
    {view}
    {game}
    {conn}
    {me}
    {finished}
    {winnerTeams}
    {reasonText}
    {teamRows}
    {scores}
    {resolution}
    {playerName}
    {colorOf}
  />

  {#if attacking}
    <AttackBar
      {selection}
      {diceOptions}
      {dice}
      {describe}
      ondice={(n) => (chosenDice = n)}
      onattack={attack}
      onblitz={blitz}
    />
  {/if}

  {#if fortifying}
    <FortifyBar
      fortify={game.fortify}
      hasOrigins={moveOrigins.length > 0}
      {selection}
      {moveCount}
      {maxMove}
      locked={moveLocked}
      {describe}
      oncount={(n) => (chosenMove = n)}
      onmove={fortify}
    />
  {/if}

  {#if pending && !finished}
    <OccupyBar
      {pending}
      {occupying}
      bind:count={occupyCount}
      activeName={playerName(game.activePlayerId)}
      {territoryName}
      onoccupy={() => conn.sendAction({ type: "occupy", count: occupyCount })}
    />
  {/if}

  <div class="body">
    {#if data}
      <div class="map-area">
      <MapCanvas
        {data}
        territories={game.territories}
        {marks}
        flash={flashIds}
        ownerName={playerName}
        ownerColor={colorOf}
        ontap={tap}
        seaClosed={game.worldEvent?.kind === "storm"}
        eventContinent={game.worldEvent?.continentId ?? null}
      />
      </div>
    {:else}
      <p class="error">Unbekannte Karte „{game.mapId}“.</p>
    {/if}

    <PlayerLegend {view} {game} {conn} {me} {out} {playerName} {colorOf} />
  </div>

  {#if !finished}
    <HandPanel {game} {mates} {playerName} {territoryName} />
  {/if}

  {#if shownTrade}
    <TradeNote
      trade={shownTrade}
      line={tradeLine(shownTrade, playerName, territoryName)}
      onclose={() => (shownTrade = null)}
    />
  {/if}

  {#if missionOpen && myMission}
    <MissionSheet
      text={missionText(myMission, missionCtx)}
      replaced={game.secret.missionReplaced}
      {progress}
      onclose={() => (missionOpen = false)}
    />
  {/if}

  {#if tradeOpen && canTrade}
    <TradeDialog
      hand={game.secret.hand}
      suggestedSets={game.secret.suggestedSets}
      {mustTrade}
      {territoryName}
      ontrade={trade}
      onclose={() => (tradeOpen = false)}
    />
  {/if}

  <CombatField bind:shown bind:playback {playerName} {colorOf} {territoryName} />

  {#if conn.notice}<div class="toast" role="alert">{conn.notice}</div>{/if}
</div>
{/if}

<style>
  .game {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .map-area {
    position: relative;
    width: 100%;
    aspect-ratio: 1.5;
    max-height: calc(100dvh - 9rem);
    min-height: 16rem;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    padding: 0.8rem 1.2rem;
    background: var(--danger);
    color: #1b1b1b;
    font-weight: 700;
    border-radius: 10px;
    max-width: 90vw;
  }

  @media (orientation: landscape) {
    .body {
      flex-direction: row;
    }
    .map-area {
      flex: 1;
      min-width: 0;
      aspect-ratio: auto;
      height: calc(100dvh - 4.5rem);
      max-height: none;
    }
  }
</style>
