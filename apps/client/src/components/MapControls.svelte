<script lang="ts">
  interface Props {
    canZoomIn: boolean;
    canZoomOut: boolean;
    onzoomin: () => void;
    onzoomout: () => void;
    onfit: () => void;
  }
  let { canZoomIn, canZoomOut, onzoomin, onzoomout, onfit }: Props = $props();
</script>

<div class="controls" role="group" aria-label="Kartenzoom">
  <button class="secondary" aria-label="Vergrößern" disabled={!canZoomIn} onclick={onzoomin}>+</button>
  <button class="secondary" aria-label="Verkleinern" disabled={!canZoomOut} onclick={onzoomout}>−</button>
  <button class="secondary" aria-label="Ganze Karte einpassen" onclick={onfit}>
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path
        d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</div>

<style>
  .controls {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  button {
    min-width: var(--tap);
    min-height: var(--tap);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    line-height: 1;
    opacity: 0.94;
  }
</style>
