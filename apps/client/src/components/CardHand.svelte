<script lang="ts">
  import type { GameViewMessage } from "@wagnis/shared";
  import { kindName } from "../lib/cards.js";
  import CardSymbol from "./CardSymbol.svelte";

  type Card = GameViewMessage["secret"]["hand"][number];

  let {
    hand,
    territoryName,
    selected = [],
    onpick,
  }: {
    hand: Card[];
    territoryName: (id: string) => string;
    /** Card ids to mark as chosen (trade dialog only). */
    selected?: string[];
    /** When set, cards are tappable (trade dialog); otherwise they are display only. */
    onpick?: (id: string) => void;
  } = $props();
</script>

<ul class="hand" aria-label="Deine Karten">
  {#each hand as card (card.id)}
    <li>
      {#if onpick}
        <button
          class="card secondary"
          class:chosen={selected.includes(card.id)}
          aria-pressed={selected.includes(card.id)}
          onclick={() => onpick(card.id)}
        >
          <CardSymbol kind={card.kind} />
          <span class="kind">{kindName[card.kind]}</span>
          <span class="where">{card.territoryId ? territoryName(card.territoryId) : "–"}</span>
        </button>
      {:else}
        <div class="card">
          <CardSymbol kind={card.kind} />
          <span class="kind">{kindName[card.kind]}</span>
          <span class="where">{card.territoryId ? territoryName(card.territoryId) : "–"}</span>
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .hand {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    min-width: 5.2rem;
    min-height: 4.6rem;
    padding: 0.4rem 0.5rem;
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 10px;
    font-weight: 500;
  }
  button.card.chosen {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .kind {
    font-size: 0.85rem;
    font-weight: 700;
  }
  .where {
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
