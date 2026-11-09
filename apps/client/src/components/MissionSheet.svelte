<script lang="ts">
  let {
    text,
    replaced,
    onclose,
  }: {
    /** The mission sentence for the viewer's own mission (made in `lib/missions.ts`). */
    text: string;
    replaced: boolean;
    onclose: () => void;
  } = $props();
</script>

<div class="overlay">
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Meine Mission">
    <h2>Meine Mission</h2>
    {#if replaced}
      <p class="replaced" role="status">Ersatzmission</p>
    {/if}
    <p class="mission">{text}</p>
    <p class="note">Zeig sie niemandem. Das Blatt schließt sich erst, wenn du es schließt.</p>
    <div class="actions">
      <button onclick={onclose}>Schließen</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }
  .sheet {
    width: min(32rem, 100%);
    max-height: 90dvh;
    overflow-y: auto;
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px 14px 0 0;
  }
  .mission {
    margin: 0.6rem 0;
    font-size: 1.3rem;
    font-weight: 700;
  }
  .replaced {
    display: inline-block;
    margin: 0;
    padding: 0.2rem 0.6rem;
    background: var(--panel-2);
    border-left: 4px solid var(--accent);
    border-radius: 6px;
    font-weight: 600;
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }
</style>
