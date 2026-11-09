<script lang="ts">
  // Gradients and patterns of the map drawing, defined once. Colors come from styles/colors.css via CSS variables.
  import { PATTERNS, WAVE_TILE } from "../maps/decor.js";
  import type { Terrain } from "../maps/decor.js";

  interface Props {
    atlas: boolean;
    width: number;
    height: number;
    /** Terrain patterns this map uses (at most three, one tile each). */
    terrains: readonly Terrain[];
  }
  let { atlas, width, height, terrains }: Props = $props();
</script>

<defs>
  <linearGradient id="map-sea" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" style="stop-color: var(--map-sea-0)" />
    <stop offset="1" style="stop-color: var(--map-sea-1)" />
  </linearGradient>
  <!-- Lighting of the land: bright top left, dark bottom right, one gradient for the whole map. -->
  <linearGradient id="map-light" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={width} y2={height}>
    <stop offset="0" style="stop-color: var(--map-light); stop-opacity: 0.18" />
    <stop offset="1" style="stop-color: var(--map-shade); stop-opacity: 0.14" />
  </linearGradient>
  {#each terrains as kind (kind)}
    {@const tile = PATTERNS[kind]}
    <pattern
      id={`map-pattern-${kind}`}
      width={tile.size}
      height={tile.size}
      patternUnits="userSpaceOnUse"
    >
      {#if tile.mode === "stroke"}
        <path
          d={tile.d}
          fill="none"
          stroke-width="0.9"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="stroke: var(--map-pattern)"
        />
      {:else}
        <path d={tile.d} style="fill: var(--map-pattern)" />
      {/if}
    </pattern>
  {/each}
  {#if atlas}
    <pattern
      id="map-waves"
      width={WAVE_TILE.width}
      height={WAVE_TILE.height}
      patternUnits="userSpaceOnUse"
    >
      <path
        d={WAVE_TILE.d}
        fill="none"
        stroke-width="1.1"
        stroke-linecap="round"
        style="stroke: var(--map-wave)"
      />
    </pattern>
  {/if}
</defs>
