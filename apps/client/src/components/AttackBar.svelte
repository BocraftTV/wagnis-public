<script lang="ts">
  // The attack bar: dice choice once an origin is chosen, the hint or both territories, attack and blitz.
  import type { Selection } from "../lib/attack.js";

  let {
    selection,
    diceOptions,
    dice,
    describe,
    ondice,
    onattack,
    onblitz,
  }: {
    selection: Selection;
    diceOptions: number[];
    dice: number;
    describe: (id: string) => string;
    ondice: (n: number) => void;
    onattack: () => void;
    onblitz: () => void;
  } = $props();
</script>

<section class="bar" aria-label="Angriff">
  {#if selection.from}
    <span class="dice-label">Würfel</span>
    <div class="dice-pick" role="group" aria-label="Anzahl Würfel">
      {#each diceOptions as n (n)}
        <button
          class:secondary={dice !== n}
          aria-pressed={dice === n}
          onclick={() => ondice(n)}>{n}</button
        >
      {/each}
    </div>
  {/if}
  <span class="hint">
    {#if !selection.from}Eigenes Gebiet antippen, von dem du angreifst.
    {:else if !selection.to}Angrenzendes fremdes oder neutrales Gebiet antippen.
    {:else}{describe(selection.from)} → {describe(selection.to)}{/if}
  </span>
  <button disabled={!selection.to || dice < 1} onclick={onattack}>Angreifen</button>
  <button disabled={!selection.to} onclick={onblitz}>Blitz</button>
</section>

<style>
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
</style>
