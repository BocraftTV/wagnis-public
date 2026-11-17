<script lang="ts">
  // The fortify bar: progress of the moves, the hint or both territories with the count, stepper and button.
  import type { GameViewMessage } from "@wagnis/shared";
  import type { Selection } from "../lib/attack.js";
  import { fortifyProgress, movesDoneOf } from "../lib/fortify.js";
  import { fortifyHintText } from "../lib/messages.js";

  let {
    fortify,
    hasOrigins,
    selection,
    moveCount,
    maxMove,
    locked,
    describe,
    oncount,
    onmove,
  }: {
    fortify: GameViewMessage["fortify"];
    hasOrigins: boolean;
    selection: Selection;
    moveCount: number;
    maxMove: number;
    locked: boolean;
    describe: (id: string) => string;
    oncount: (n: number) => void;
    onmove: () => void;
  } = $props();
</script>

<section class="bar" aria-label="Verschieben">
  <span class="hint">
    {#if fortifyProgress(fortify)}<strong>{fortifyProgress(fortify)}</strong>{" "}{/if}
    {#if !hasOrigins}{fortifyHintText("none", movesDoneOf(fortify))}
    {:else if !selection.from}{fortifyHintText("pick-origin", movesDoneOf(fortify))}
    {:else if !selection.to}{fortifyHintText("pick-target", movesDoneOf(fortify))}
    {:else}{describe(selection.from)} → {describe(selection.to)}: {moveCount} Armeen{/if}
  </span>
  {#if selection.to}
    <div class="dice-pick">
      <button
        class="secondary"
        aria-label="Weniger"
        disabled={moveCount <= 1}
        onclick={() => oncount(moveCount - 1)}>−</button
      >
      <span class="count">{moveCount}</span>
      <button
        class="secondary"
        aria-label="Mehr"
        disabled={moveCount >= maxMove}
        onclick={() => oncount(moveCount + 1)}>+</button
      >
    </div>
  {/if}
  <button disabled={!selection.to || moveCount < 1 || locked} onclick={onmove}
    >Verschieben</button
  >
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
</style>
