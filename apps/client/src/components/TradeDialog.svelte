<script lang="ts">
  import {
    bonusChoices,
    bonusToSend,
    matchingSuggestion,
    pruneChoice,
    toggleChoice,
  } from "../lib/cards.js";
  import type { Card, SuggestedSet } from "../lib/cards.js";
  import CardHand from "./CardHand.svelte";

  let {
    hand,
    suggestedSets,
    mustTrade,
    territoryName,
    ontrade,
    onclose,
  }: {
    hand: Card[];
    suggestedSets: SuggestedSet[];
    mustTrade: boolean;
    territoryName: (id: string) => string;
    ontrade: (cardIds: string[], bonusTerritoryId: string | undefined) => void;
    onclose: () => void;
  } = $props();

  let selected = $state<string[]>([]);
  $effect(() => {
    const next = pruneChoice(selected, hand);
    if (next !== selected) selected = next;
  });

  // A free choice sends no bonus territory; a choice equal to a suggestion sends that suggestion's bonus.
  const matching = $derived(matchingSuggestion(selected, suggestedSets));

  // Bonus territory: offered only among the chosen cards the view marks `bonusEligible`.
  let pickedBonus = $state<string | null>(null);
  const choices = $derived(bonusChoices(hand, selected));
  const bonus = $derived(bonusToSend(choices, pickedBonus, matching?.bonusTerritoryId));
  $effect(() => {
    if (pickedBonus && !choices.includes(pickedBonus)) pickedBonus = null;
  });

  function trade() {
    if (selected.length !== 3) return;
    ontrade(selected, bonus);
  }
</script>

<div class="overlay">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Karten tauschen">
    <h2>Karten tauschen</h2>
    {#if mustTrade}
      <p class="must" role="status">Du hast 5 oder mehr Karten und musst tauschen.</p>
    {/if}

    {#if suggestedSets.length > 0}
      <h3>Vorschläge</h3>
      <ul class="suggestions">
        {#each suggestedSets as set (set.cardIds.join("+"))}
          <li>
            <button
              class="secondary"
              class:chosen={matching === set}
              aria-pressed={matching === set}
              onclick={() => (selected = [...set.cardIds])}
            >
              <strong>{set.value} Armeen</strong>
              <span class="muted">
                {#if set.bonusTerritoryId}Bonus auf {territoryName(set.bonusTerritoryId)}{:else}ohne
                  Gebietsbonus{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>Oder drei Karten selbst wählen ({selected.length}/3)</h3>
    <CardHand {hand} {territoryName} {selected} onpick={(id) => (selected = toggleChoice(selected, id))} />

    {#if selected.length === 3 && choices.length > 1}
      <h3>Bonusgebiet wählen</h3>
      <div class="bonus" role="group" aria-label="Bonusgebiet">
        {#each choices as id (id)}
          <button
            class="secondary"
            class:chosen={bonus === id}
            aria-pressed={bonus === id}
            onclick={() => (pickedBonus = id)}>{territoryName(id)}</button
          >
        {/each}
      </div>
    {/if}

    <div class="actions">
      <button class="secondary" onclick={onclose}>Schließen</button>
      <button disabled={selected.length !== 3} onclick={trade}>Tauschen</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }
  .dialog {
    width: min(40rem, 100%);
    max-height: 90dvh;
    overflow-y: auto;
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px 14px 0 0;
  }
  .dialog h3 {
    margin: 1rem 0 0.5rem;
    font-size: 0.95rem;
    color: var(--muted);
  }
  .must {
    margin: 0;
    padding: 0.5rem 0.7rem;
    background: var(--panel-2);
    border-left: 4px solid var(--accent);
    border-radius: 6px;
  }
  .suggestions {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
  }
  .suggestions button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.4rem 0.8rem;
    text-align: left;
  }
  .bonus {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .bonus button.chosen,
  .suggestions button.chosen {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .muted {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
</style>
