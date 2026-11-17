<script lang="ts">
  // The status line of the game (whose turn, round, phase, armies to place, the own mission and the end button) and the
  // bands below it: the world event, the hold-to-win hint, the mission progress and the trade bar.
  import type { GameViewMessage } from "@wagnis/shared";
  import { phaseText } from "../lib/messages.js";
  import { roundText } from "../lib/rounds.js";

  let {
    game,
    myTurn,
    finished,
    showMission,
    endDisabled,
    playerName,
    colorOf,
    onmission,
    onendphase,
    eventLine,
    pendingBanner,
    progress,
    trade,
    onopentrade,
  }: {
    game: GameViewMessage;
    myTurn: boolean;
    finished: boolean;
    showMission: boolean;
    endDisabled: boolean;
    playerName: (id: string | null) => string;
    colorOf: (id: string | null) => string;
    onmission: () => void;
    onendphase: () => void;
    eventLine: { title: string; text: string } | null;
    pendingBanner: string | null;
    progress: string | null;
    /** The trade bar: a required trade, a possible one, or none. */
    trade: "must" | "may" | null;
    onopentrade: () => void;
  } = $props();
</script>

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
  {#if showMission}
    <button class="secondary mission-btn" onclick={onmission}>Meine Mission</button>
  {/if}
  {#if !finished}
    <button disabled={endDisabled} onclick={onendphase}>
      {game.phase === "attack" ? "Angriff beenden" : game.phase === "fortify" ? "Zug beenden" : "Phase beenden"}
    </button>
  {/if}
</header>

{#if eventLine}
  <div class="event-banner" role="status">
    <strong>Ereignis: {eventLine.title}.</strong>
    {eventLine.text}
  </div>
{/if}
{#if pendingBanner}
  <div class="pending-banner" role="status">{pendingBanner}</div>
{/if}
{#if progress}
  <div class="progress" role="status">{progress}</div>
{/if}

{#if trade === "must"}
  <section class="bar" aria-label="Pflichttausch">
    <span class="hint">Du hast 5 oder mehr Karten und musst tauschen.</span>
    <button onclick={onopentrade}>Tauschen</button>
  </section>
{:else if trade === "may"}
  <section class="bar" aria-label="Karten tauschen">
    <span class="hint">Du hast {game.secret.hand.length} Karten.</span>
    <button class="secondary" onclick={onopentrade}>Tauschen</button>
  </section>
{/if}

<style>
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
    flex: none; /* never squeezed away next to the team label: the shade tells the partners apart (plan 015) */
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
</style>
