<script lang="ts">
  // The trade field: the traded cards and the line about the trade, shown to all players until tapped away.
  import type { GameViewMessage } from "@wagnis/shared";
  import CardSymbol from "./CardSymbol.svelte";

  let {
    trade,
    line,
    onclose,
  }: {
    trade: NonNullable<GameViewMessage["lastTrade"]>;
    line: string;
    onclose: () => void;
  } = $props();
</script>

<div
  class="trade-note"
  role="button"
  tabindex="0"
  aria-label="Tausch, antippen zum Schließen"
  onclick={onclose}
  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onclose()}
>
  {#each trade.cards as c (c.id)}<CardSymbol kind={c.kind} size={20} />{/each}
  {line}
</div>

<style>
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
</style>
