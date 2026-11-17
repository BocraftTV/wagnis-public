<script lang="ts" generics="T">
  // One choice of the host in the lobby: a row of buttons (the chosen one pressed) and a hint below. The choice always
  // shows the last snapshot: no local anticipation.
  let {
    label,
    options,
    selected,
    hint,
    onpick,
  }: {
    /** Name of the button group for screen readers. */
    label: string;
    options: readonly { value: T; label: string }[];
    selected: T;
    hint: string;
    onpick: (value: T) => void;
  } = $props();
</script>

<div class="seg" role="group" aria-label={label}>
  {#each options as o (o.value)}
    <button
      class:secondary={selected !== o.value}
      aria-pressed={selected === o.value}
      onclick={() => onpick(o.value)}>{o.label}</button
    >
  {/each}
</div>
<p class="muted">{hint}</p>

<style>
  .muted {
    color: var(--muted);
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
