<script lang="ts">
  import type { GameViewMessage } from "@wagnis/shared";

  type Kind = GameViewMessage["secret"]["hand"][number]["kind"];
  let { kind, size = 28 }: { kind: Kind; size?: number } = $props();
</script>

<!-- Own simple geometric symbols, drawn inline: no files, no external graphics. -->
<svg
  class="symbol"
  width={size}
  height={size}
  viewBox="0 0 32 32"
  role="img"
  aria-hidden="true"
  fill="currentColor"
>
  {#if kind === "infantry"}
    <circle cx="16" cy="9" r="5" />
    <path d="M6 28 C6 18 11 15 16 15 C21 15 26 18 26 28 Z" />
  {:else if kind === "cavalry"}
    <path d="M4 26 L16 6 L28 26 L22 26 L16 16 L10 26 Z" />
  {:else if kind === "artillery"}
    <circle cx="11" cy="23" r="5" />
    <rect x="13" y="8" width="16" height="7" rx="2" transform="rotate(-20 13 14)" />
    <rect x="3" y="27" width="22" height="3" rx="1.5" />
  {:else}
    <path d="M16 2 L19.5 12 L30 12.5 L21.8 19 L24.8 29 L16 23 L7.2 29 L10.2 19 L2 12.5 L12.5 12 Z" />
  {/if}
</svg>

<style>
  .symbol {
    flex: none;
  }
</style>
