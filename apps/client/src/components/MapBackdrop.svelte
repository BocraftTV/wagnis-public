<script lang="ts">
  // Static background of the map in map units: sea, waves, grid, compass rose and the neatline frame. Nothing here
  // depends on the zoom (line widths are screen px via non-scaling-stroke), so a pan or pinch moves it as one block.
  import { FRAME_UNIT, frame, gridPath, plainGridPath, ROSE } from "../maps/decor.js";
  import type { RenderLayout } from "../maps/index.js";

  interface Props {
    layout: RenderLayout;
  }
  let { layout }: Props = $props();

  const w = $derived(layout.viewBox.width);
  const h = $derived(layout.viewBox.height);
  const grid = $derived(layout.atlas ? gridPath() : plainGridPath(w, h));
  const fr = $derived(frame(FRAME_UNIT, w, h));
  const rose = ROSE;
</script>

<g class="backdrop">
  <rect width={w} height={h} fill="url(#map-sea)" />
  {#if layout.atlas}
    <rect class="waves" width={w} height={h} fill="url(#map-waves)" />
  {/if}
  <path class="grid" d={grid} />
  {#if layout.atlas}
    <g class="rose">
      <circle class="rose-ring" cx={rose.center.x} cy={rose.center.y} r={rose.rings[0]} />
      <circle class="rose-ring" cx={rose.center.x} cy={rose.center.y} r={rose.rings[1]} />
      <path class="rose-dark" d={rose.dark} />
      <path class="rose-light" d={rose.light} />
      <text class="rose-n" x={rose.north.x} y={rose.north.y} text-anchor="middle" dominant-baseline="central">
        N
      </text>
    </g>
  {/if}
  <rect class="frame outer" x={fr.outer[0]} y={fr.outer[1]} width={fr.outer[2]} height={fr.outer[3]} />
  <rect class="frame inner" x={fr.inner[0]} y={fr.inner[1]} width={fr.inner[2]} height={fr.inner[3]} />
  <path class="frame-corners" d={fr.corners} />
</g>

<style>
  .backdrop {
    pointer-events: none;
  }
  .waves {
    opacity: 0.35;
  }
  .grid {
    fill: none;
    stroke: var(--map-grid);
    stroke-width: 1px;
    opacity: 0.3;
    vector-effect: non-scaling-stroke;
  }
  .rose-ring {
    fill: none;
    stroke: var(--map-frame);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .rose-dark {
    fill: var(--map-rose-dark);
  }
  .rose-light {
    fill: var(--map-rose-light);
    stroke: var(--map-rose-dark);
    stroke-width: 0.8px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .rose-n {
    fill: var(--map-frame);
    font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", Georgia, serif;
    font-size: 14px;
    font-weight: 700;
  }
  .frame {
    fill: none;
    stroke: var(--map-frame);
    vector-effect: non-scaling-stroke;
  }
  .frame.outer {
    stroke-width: 2px;
  }
  .frame.inner {
    stroke-width: 1px;
  }
  .frame-corners {
    fill: var(--map-frame);
  }
</style>
