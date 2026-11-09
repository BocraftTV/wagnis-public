<script lang="ts">
  import { qrMatrix } from "../lib/qr/matrix.js";
  import { matrixPath, moduleSize, symbolModules } from "../lib/qr/render.js";

  let {
    text,
    available,
    label,
  }: {
    /** What the code encodes. */
    text: string;
    /** Largest edge in pixels; the code uses whole pixels per module. */
    available: number;
    label: string;
  } = $props();

  const code = $derived.by(() => {
    const result = qrMatrix(text);
    if (!result.ok) return null;
    return { path: matrixPath(result.matrix), modules: symbolModules(result.matrix) };
  });
  const edge = $derived(code ? moduleSize(available, code.modules) * code.modules : 0);
</script>

{#if code}
  <svg
    viewBox={`0 0 ${code.modules} ${code.modules}`}
    width={edge}
    height={edge}
    role="img"
    aria-label={label}
    shape-rendering="crispEdges"
  >
    <rect class="light" width={code.modules} height={code.modules} />
    <path class="dark" d={code.path} />
  </svg>
{/if}

<style>
  svg {
    display: block;
    max-width: 100%;
  }
  .light {
    fill: var(--qr-light);
  }
  .dark {
    fill: var(--qr-dark);
  }
</style>
