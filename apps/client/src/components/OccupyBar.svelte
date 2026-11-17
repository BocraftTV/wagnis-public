<script lang="ts">
  // The move-in bar after a conquest: the own stepper and button, or a note while another player moves in.
  import type { GameViewMessage } from "@wagnis/shared";

  let {
    pending,
    occupying,
    count = $bindable(),
    activeName,
    territoryName,
    onoccupy,
  }: {
    pending: NonNullable<GameViewMessage["pendingOccupation"]>;
    occupying: boolean;
    count: number;
    activeName: string;
    territoryName: (id: string) => string;
    onoccupy: () => void;
  } = $props();
</script>

<section class="bar" aria-label="Nachrücken">
  {#if occupying}
    <span class="hint">
      Nachrücken nach {territoryName(pending.to)}: {count} Armeen
    </span>
    <div class="dice-pick">
      <button
        class="secondary"
        aria-label="Weniger"
        disabled={count <= pending.min}
        onclick={() => count--}>−</button
      >
      <span class="count">{count}</span>
      <button
        class="secondary"
        aria-label="Mehr"
        disabled={count >= pending.max}
        onclick={() => count++}>+</button
      >
    </div>
    <button onclick={onoccupy}>
      Nachrücken
    </button>
  {:else}
    <span class="hint">{activeName} zieht nach …</span>
  {/if}
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
