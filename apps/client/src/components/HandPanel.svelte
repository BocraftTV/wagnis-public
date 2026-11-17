<script lang="ts">
  // The own cards with the piles, and in a team game the cards of the partners (rules.md 13).
  import type { GameViewMessage } from "@wagnis/shared";
  import CardHand from "./CardHand.svelte";

  let {
    game,
    mates,
    playerName,
    territoryName,
  }: {
    game: GameViewMessage;
    mates: string[];
    playerName: (id: string | null) => string;
    territoryName: (id: string) => string;
  } = $props();
</script>

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

<style>
  .mate-hand {
    margin: 0.8rem 0 0.3rem;
    font-size: 0.95rem;
  }
  .muted {
    color: var(--muted);
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
</style>
