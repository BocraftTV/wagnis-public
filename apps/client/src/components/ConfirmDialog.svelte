<script lang="ts">
  // Own overlay with a focus trap (no <dialog> needed): the cancel button has the focus first, Tab stays inside,
  // Escape cancels. The text names what happens; the server still checks everything.
  let {
    text,
    confirmLabel,
    onconfirm,
    oncancel,
  }: {
    text: string;
    confirmLabel: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();

  let box = $state<HTMLDivElement>();
  let cancelButton = $state<HTMLButtonElement>();

  $effect(() => {
    cancelButton?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      oncancel();
      return;
    }
    if (e.key !== "Tab" || !box) return;
    const items = [...box.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!box.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="overlay">
  <div class="dialog" role="alertdialog" aria-modal="true" aria-label="Bestätigen" bind:this={box}>
    <p class="text">{text}</p>
    <div class="actions">
      <button class="secondary" bind:this={cancelButton} onclick={oncancel}>Abbrechen</button>
      <button onclick={onconfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
      max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  }
  .dialog {
    width: min(26rem, 100%);
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .text {
    margin: 0 0 1rem;
    line-height: 1.4;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
</style>
