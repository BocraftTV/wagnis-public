<script lang="ts">
  import type { GameViewMessage, RoomView } from "@wagnis/shared";
  import type { GameConnection } from "../lib/connection.svelte.js";
  import {
    combatDisplay,
    effectiveDice,
    eliminatedPlayers,
    emptySelection,
    pairDice,
    pruneSelection,
    selectionAfterTap,
    targetsFrom,
  } from "../lib/attack.js";
  import type { Selection } from "../lib/attack.js";
  import {
    effectiveMove,
    fortifyOrigins,
    fortifyProgress,
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
  import CardHand from "../components/CardHand.svelte";
  import CardSymbol from "../components/CardSymbol.svelte";
  import DiceRoll from "../components/DiceRoll.svelte";
  import MapCanvas from "../components/MapCanvas.svelte";
  import HostMenu from "../components/HostMenu.svelte";
  import MissionChoice from "../components/MissionChoice.svelte";
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
  import { roundText, scoreRows, winnersText } from "../lib/rounds.js";
  import { eventText, eventTitle } from "../lib/events.js";
  import { mateIds, teamName, teamOfPlayer, teamScoreRows, teamWinText } from "../lib/teams.js";
  import { armiesText } from "../lib/hint.js";
  import { backToLobbyMessage, canBackToLobby, nameWithMark, playerStatus } from "../lib/host.js";
  import type { TerritoryMark } from "../lib/mark.js";
  import { fortifyHintText, phaseText } from "../lib/messages.js";
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
  const teamRows = $derived(teamScoreRows(game.teamScores, game.winnerTeamId));
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

  function pickable(id: string): boolean {
    const t = game.territories[id];
    if (!t) return false;
    if (placing) return t.ownerId === me;
    if (fortifying) {
      return selection.from ? moveTargets.includes(id) || moveOrigins.includes(id) : moveOrigins.includes(id);
    }
    if (!attacking) return false;
    return t.ownerId === me ? (t.maxAttackDice ?? 0) > 0 : targets.includes(id);
  }

  // Ring marks for the map, from the same rules the taps use.
  const marks = $derived.by(() => {
    const out: Record<string, TerritoryMark> = {};
    if (!data) return out;
    const choosing = attacking || fortifying;
    for (const t of data.map.territories) {
      const st = game.territories[t.id];
      if (!st) continue;
      const isFrom = choosing && selection.from === t.id;
      const isTo = choosing && selection.to === t.id;
      const canPick = pickable(t.id);
      const tone = fortifying
        ? "move"
        : attacking && (isTo || (!isFrom && st.ownerId !== me))
          ? "attack"
          : "place";
      out[t.id] = {
        pickable: canPick,
        ring: isFrom || isTo ? "chosen" : canPick ? "pick" : "none",
        tone,
      };
    }
    return out;
  });

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
  // decoration on top (plan 008): the gate decides per snapshot, the text is there from the start.
  const FIELD_MS = 6000;
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
    if (!playback) return;
    const h = setTimeout(() => (playback = null), playback.totalMs);
    return () => clearTimeout(h);
  });
  // A tap skips a running animation first; the next tap closes the field.
  function tapField() {
    if (playback) playback = null;
    else shown = null;
  }
  $effect(() => {
    if (!shown) return;
    const h = setTimeout(() => (shown = null), FIELD_MS);
    return () => clearTimeout(h);
  });
  $effect(() => {
    if (!flash) return;
    const h = setTimeout(() => (flash = null), FLASH_MS);
    return () => clearTimeout(h);
  });
  const flashIds = $derived(flash ? [flash.from, flash.to] : []);
  const display = $derived(shown ? combatDisplay(shown) : null);
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
  <header class="status">
    <div class="who" class:mine={myTurn}>
      <span class="swatch" style:background={colorOf(game.activePlayerId)}></span>
      <strong>{myTurn ? "Du bist am Zug" : `${playerName(game.activePlayerId)} ist am Zug`}</strong>
    </div>
    <div>{roundText(game.round, game.roundLimit)}</div>
    <div>Phase: <strong>{phaseText[game.phase]}</strong></div>
    {#if game.phase === "reinforce"}
      <div>Zu setzen: <strong>{game.reinforcementsLeft}</strong></div>
    {/if}
    {#if myMission && !finished}
      <button class="secondary mission-btn" onclick={() => (missionOpen = true)}>Meine Mission</button>
    {/if}
    {#if !finished}
      <button
        disabled={!myTurn || pending !== null || (game.phase === "reinforce" && mustTrade)}
        onclick={() => conn.sendAction({ type: "endPhase" })}
      >
        {game.phase === "attack" ? "Angriff beenden" : game.phase === "fortify" ? "Zug beenden" : "Phase beenden"}
      </button>
    {/if}
  </header>

  {#if game.worldEvent && !finished}
    <div class="event-banner" role="status">
      <strong>Ereignis: {eventTitle(game.worldEvent.kind)}.</strong>
      {eventText(game.worldEvent, missionCtx)}
    </div>
  {/if}
  {#if pendingBanner}
    <div class="pending-banner" role="status">{pendingBanner}</div>
  {/if}
  {#if progress && !finished}
    <div class="progress" role="status">{progress}</div>
  {/if}

  {#if myTurn && game.phase === "reinforce" && mustTrade && !finished}
    <section class="bar" aria-label="Pflichttausch">
      <span class="hint">Du hast 5 oder mehr Karten und musst tauschen.</span>
      <button onclick={() => (tradeOpen = true)}>Tauschen</button>
    </section>
  {:else if canTrade}
    <section class="bar" aria-label="Karten tauschen">
      <span class="hint">Du hast {game.secret.hand.length} Karten.</span>
      <button class="secondary" onclick={() => (tradeOpen = true)}>Tauschen</button>
    </section>
  {/if}

  {#if finished && game.winnerId}
    <div class="winner" role="status">
      🏆 {game.winnerTeamId
        ? teamWinText(game.winnerTeamId, game.winnerIds, playerName)
        : winnersText(game.winnerIds, game.winnerId, playerName, me)}{reasonText
        ? ` – ${reasonText}`
        : ""}
    </div>
  {/if}

  {#if finished}
    <section class="after" aria-label="Nach dem Spiel">
      {#if canBackToLobby(view)}
        <p class="muted">
          Alle kommen zurück in die Lobby und bleiben eingetragen; dort wählst du Karte und
          Siegmodus für die nächste Partie.
        </p>
        <button onclick={() => conn.sendHost(backToLobbyMessage())}>Zurück zur Lobby</button>
      {:else}
        <p class="muted" role="status">Warte auf den Host …</p>
      {/if}
    </section>
  {/if}

  {#if finished && teamRows.length > 0}
    <section class="resolution" aria-label="Teamwertung">
      <h2>Teamwertung</h2>
      <ul>
        {#each teamRows as row (row.teamId)}
          <li>
            <strong>{row.winner ? "🏆 " : ""}{teamName(row.teamId)}: {row.points} Punkte</strong>
            <span class="mission-line"
              >{row.members.map(playerName).join(", ")} · {row.armies} Armeen</span
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if finished && scores.length > 0}
    <section class="resolution" aria-label="Wertung">
      <h2>Wertung nach {game.round} Runden</h2>
      <ul>
        {#each scores as row (row.playerId)}
          <li>
            <span class="swatch" style:background={colorOf(row.playerId)}></span>
            <strong
              >{row.winner ? "🏆 " : ""}{playerName(row.playerId)}{row.playerId === me
                ? " (du)"
                : ""}: {row.points} Punkte</strong
            >
            <span class="mission-line">{row.detail}, {row.armies} Armeen</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if finished && resolution && resolution.length > 0}
    <section class="resolution" aria-label="Auflösung der Missionen">
      <h2>Auflösung</h2>
      <ul>
        {#each resolution as row (row.playerId)}
          <li>
            <span class="swatch" style:background={colorOf(row.playerId)}></span>
            <strong>{playerName(row.playerId)}{row.playerId === me ? " (du)" : ""}</strong>
            <span class="mission-line">{row.current}</span>
            {#if row.original}
              <span class="replaced-line">ersetzt: ursprünglich gezogen: {row.original}</span>
            {/if}
            {#if row.discarded}
              <span class="replaced-line">abgeworfen: {row.discarded}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if attacking}
    <section class="bar" aria-label="Angriff">
      {#if selection.from}
        <span class="dice-label">Würfel</span>
        <div class="dice-pick" role="group" aria-label="Anzahl Würfel">
          {#each diceOptions as n (n)}
            <button
              class:secondary={dice !== n}
              aria-pressed={dice === n}
              onclick={() => (chosenDice = n)}>{n}</button
            >
          {/each}
        </div>
      {/if}
      <span class="hint">
        {#if !selection.from}Eigenes Gebiet antippen, von dem du angreifst.
        {:else if !selection.to}Angrenzendes fremdes oder neutrales Gebiet antippen.
        {:else}{describe(selection.from)} → {describe(selection.to)}{/if}
      </span>
      <button disabled={!selection.to || dice < 1} onclick={attack}>Angreifen</button>
      <button disabled={!selection.to} onclick={blitz}>Blitz</button>
    </section>
  {/if}

  {#if fortifying}
    <section class="bar" aria-label="Verschieben">
      <span class="hint">
        {#if fortifyProgress(game.fortify)}<strong>{fortifyProgress(game.fortify)}</strong>{" "}{/if}
        {#if moveOrigins.length === 0}{fortifyHintText("none", movesDoneOf(game.fortify))}
        {:else if !selection.from}{fortifyHintText("pick-origin", movesDoneOf(game.fortify))}
        {:else if !selection.to}{fortifyHintText("pick-target", movesDoneOf(game.fortify))}
        {:else}{describe(selection.from)} → {describe(selection.to)}: {moveCount} Armeen{/if}
      </span>
      {#if selection.to}
        <div class="dice-pick">
          <button
            class="secondary"
            aria-label="Weniger"
            disabled={moveCount <= 1}
            onclick={() => (chosenMove = moveCount - 1)}>−</button
          >
          <span class="count">{moveCount}</span>
          <button
            class="secondary"
            aria-label="Mehr"
            disabled={moveCount >= maxMove}
            onclick={() => (chosenMove = moveCount + 1)}>+</button
          >
        </div>
      {/if}
      <button disabled={!selection.to || moveCount < 1 || moveLocked} onclick={fortify}
        >Verschieben</button
      >
    </section>
  {/if}

  {#if pending && !finished}
    <section class="bar" aria-label="Nachrücken">
      {#if occupying}
        <span class="hint">
          Nachrücken nach {territoryName(pending.to)}: {occupyCount} Armeen
        </span>
        <div class="dice-pick">
          <button
            class="secondary"
            aria-label="Weniger"
            disabled={occupyCount <= pending.min}
            onclick={() => occupyCount--}>−</button
          >
          <span class="count">{occupyCount}</span>
          <button
            class="secondary"
            aria-label="Mehr"
            disabled={occupyCount >= pending.max}
            onclick={() => occupyCount++}>+</button
          >
        </div>
        <button onclick={() => conn.sendAction({ type: "occupy", count: occupyCount })}>
          Nachrücken
        </button>
      {:else}
        <span class="hint">{playerName(game.activePlayerId)} zieht nach …</span>
      {/if}
    </section>
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

    <ul class="legend">
      {#each game.playerOrder as id (id)}
        {@const p = view.players.find((x) => x.id === id)}
        {@const status = playerStatus(game, id)}
        <li class:active={id === game.activePlayerId} class:out={out.has(id)}>
          <span class="swatch" style:background={colorOf(id)}></span>
          <span>{playerName(id)}{id === me ? " (du)" : ""}</span>
          {#if teamOfPlayer(game.teams, id)}
            <span class="out-label team-label">{teamName(teamOfPlayer(game.teams, id)!)}</span>
          {/if}
          <span class="presence" class:online={p?.connected}>{p?.connected ? "●" : "○"}</span>
          <span class="sr">{p?.connected ? "verbunden" : "getrennt"}</span>
          {#if p?.isHost}<span class="out-label">Host</span>{/if}
          {#if status === "removed"}<span class="out-label">entfernt</span>
          {:else if status === "eliminated"}<span class="out-label">ausgeschieden</span>{/if}
          <span class="cards-count">{game.handCounts[id] ?? 0} Karten</span>
          <HostMenu {view} {conn} playerId={id} />
        </li>
      {/each}
    </ul>
  </div>

  {#if !finished}
    <section class="hand-panel" aria-label="Karten">
      <h2>
        Deine Karten ({game.secret.hand.length})
        <span class="piles">Stapel {game.deckCount} · Ablage {game.discardCount}</span>
      </h2>
      {#if game.secret.hand.length > 0}
        <CardHand hand={game.secret.hand} {territoryName} />
      {:else}
        <p class="muted">Du hast keine Karten. Pro Zug mit Eroberung ziehst du eine.</p>
      {/if}
      {#each mates as mate (mate)}
        {@const theirs = game.secret.allyHands[mate] ?? []}
        <h3 class="mate-hand">Karten von {playerName(mate)} ({theirs.length})</h3>
        {#if theirs.length > 0}
          <CardHand hand={theirs} {territoryName} label={`Karten von ${playerName(mate)}`} />
        {:else}
          <p class="muted">{playerName(mate)} hat keine Karten.</p>
        {/if}
      {/each}
    </section>
  {/if}

  {#if shownTrade}
    <div
      class="trade-note"
      role="button"
      tabindex="0"
      aria-label="Tausch, antippen zum Schließen"
      onclick={() => (shownTrade = null)}
      onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (shownTrade = null)}
    >
      {#each shownTrade.cards as c (c.id)}<CardSymbol kind={c.kind} size={20} />{/each}
      {tradeLine(shownTrade, playerName, territoryName)}
    </div>
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

  {#if shown && display}
    <div
      class="combat"
      role="button"
      tabindex="0"
      aria-label="Kampfergebnis, antippen zum Schließen"
      onclick={tapField}
      onkeydown={(e) => (e.key === "Enter" || e.key === " ") && tapField()}
    >
      <div class="combat-head">
        <span class="swatch" style:background={colorOf(shown.attackerId)}></span>
        <strong>{playerName(shown.attackerId)}</strong> greift
        <span class="swatch" style:background={colorOf(shown.defenderId)}></span>
        <strong>{playerName(shown.defenderId)}</strong> an: {territoryName(shown.from)} → {territoryName(
          shown.to,
        )}
      </div>
      {#if display.showSummary}
        <div class="combat-sum">
          Blitz: {display.rollCount} Würfe · Verluste Angreifer {shown.summary.attackerLosses},
          Verteidiger {shown.summary.defenderLosses} ·
          {shown.summary.conquered ? "erobert" : "nicht erobert"}
          {#if display.rollCount > shown.rolls.length}
            <span class="muted">(letzter Wurf:)</span>
          {/if}
        </div>
      {/if}
      {#if playback}
        {#key shown.seq}
          <DiceRoll
            combat={shown}
            {playback}
            attackerColor={colorOf(shown.attackerId)}
            defenderColor={colorOf(shown.defenderId)}
          />
        {/key}
        <div class="skip" aria-hidden="true">Antippen zum Überspringen</div>
      {/if}
      {#if display.roll}
        {#if !playback}
        <div class="pairs">
          {#each pairDice(display.roll) as p, i (i)}
            <div class="pair">
              <span class="die" class:lost={p.loser === "attacker"} class:none={p.attacker === null}
                >{p.attacker ?? ""}</span
              >
              <span class="vs">:</span>
              <span class="die" class:lost={p.loser === "defender"} class:none={p.defender === null}
                >{p.defender ?? ""}</span
              >
            </div>
          {/each}
        </div>
        {/if}
        <div class="losses">
          Verluste: Angreifer {display.roll.attackerLosses}, Verteidiger {display.roll
            .defenderLosses}{#if !display.showSummary && shown.summary.conquered}
            · erobert{/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if conn.notice}<div class="toast" role="alert">{conn.notice}</div>{/if}
</div>
{/if}

<style>
  .game {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1.4rem;
    padding: 0.6rem 1rem;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .status button {
    margin-left: auto;
  }
  .status .mission-btn {
    margin-left: 0;
  }
  .team-label {
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    padding: 0 0.35rem;
  }
  .mate-hand {
    margin: 0.8rem 0 0.3rem;
    font-size: 0.95rem;
  }
  .event-banner {
    padding: 0.5rem 1rem;
    background: var(--panel-2);
    border-left: 4px solid var(--danger);
  }
  .pending-banner {
    padding: 0.5rem 1rem;
    background: var(--panel-2);
    border-left: 4px solid var(--accent);
    font-weight: 600;
  }
  .progress {
    padding: 0.4rem 1rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .who.mine strong {
    color: var(--accent);
  }
  .swatch {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    vertical-align: -0.1rem;
    margin-right: 0.3rem;
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
  .after {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
  }
  .after p {
    margin: 0;
  }
  .winner {
    padding: 0.8rem 1rem;
    background: var(--accent);
    color: #1b1b1b;
    font-weight: 800;
    text-align: center;
  }
  .resolution {
    padding: 0.6rem 1rem;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .resolution h2 {
    font-size: 1rem;
  }
  .resolution ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
  }
  .resolution li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.1rem 0.5rem;
  }
  .mission-line {
    flex-basis: 100%;
  }
  .replaced-line {
    flex-basis: 100%;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
    padding: 0.5rem 1rem;
    background: var(--panel-2);
    border-bottom: 1px solid var(--line);
  }
  .hint {
    flex: 1;
    min-width: 10rem;
    color: var(--muted);
  }
  .dice-label {
    color: var(--muted);
  }
  .dice-pick {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .count {
    min-width: 2rem;
    text-align: center;
    font-weight: 800;
    font-size: 1.2rem;
  }
  .combat {
    position: fixed;
    left: 50%;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 5;
    width: min(26rem, calc(100vw - 2rem));
    padding: 0.7rem 0.9rem;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .combat-head,
  .combat-sum,
  .losses {
    font-size: 0.95rem;
  }
  .combat-sum {
    margin-top: 0.3rem;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .skip {
    min-height: 1.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pairs {
    display: flex;
    gap: 0.6rem;
    margin: 0.5rem 0;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .die {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 8px;
    background: #f4f4f4;
    color: #111;
    font-weight: 800;
    font-size: 1.3rem;
  }
  .die.lost {
    opacity: 0.3;
    filter: grayscale(1);
  }
  .die.none {
    background: transparent;
    border: 1px dashed var(--line);
  }
  .vs {
    color: var(--muted);
  }
  .trade-note {
    position: fixed;
    left: 50%;
    top: calc(0.6rem + env(safe-area-inset-top));
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    width: min(30rem, calc(100vw - 2rem));
    min-height: var(--tap);
    padding: 0.5rem 0.9rem;
    background: var(--panel-2);
    border: 1px solid var(--accent);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    font-size: 0.95rem;
    -webkit-tap-highlight-color: transparent;
  }
  .hand-panel {
    padding: 0.6rem 1rem calc(1rem + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .hand-panel h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 1rem;
    font-size: 1rem;
  }
  .piles {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--muted);
  }
  .cards-count {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .legend li.out {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .out-label {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .legend {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0.6rem 1rem 1rem;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 2.2rem;
    padding: 0 0.7rem;
    background: var(--panel);
    border: 1px solid transparent;
    border-radius: 999px;
  }
  .legend li.active {
    border-color: var(--accent);
  }
  .presence {
    color: var(--muted);
  }
  .presence.online {
    color: var(--ok);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
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
    .legend {
      flex-direction: column;
      flex-wrap: nowrap;
      width: 13rem;
      padding: 0.8rem 1rem;
    }
  }
</style>
