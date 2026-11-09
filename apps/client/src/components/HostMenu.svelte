<script lang="ts">
  // The host's actions for one player row: a menu button, a sheet with the actions that apply, and a confirmation
  // before anything is sent. Which actions are offered comes from `hostControls` (display only); the server decides.
  import type { RoomView } from "@wagnis/shared";
  import type { GameConnection } from "../lib/connection.svelte.js";
  import {
    confirmRemoveText,
    confirmSkipText,
    confirmTransferText,
    hostControls,
  } from "../lib/host.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let {
    view,
    conn,
    playerId,
  }: { view: RoomView; conn: GameConnection; playerId: string } = $props();

  type Kind = "skip" | "remove" | "transfer";
  const name = $derived(view.players.find((p) => p.id === playerId)?.name ?? "");
  const controls = $derived(hostControls(view)[playerId]);
  const any = $derived(!!controls && (controls.skip || controls.remove || controls.transfer));

  let sheet = $state(false);
  let confirm = $state<Kind | null>(null);
  // The turn the host saw when opening the confirmation: a skip then cannot hit the next player's turn.
  let turnSeen = $state(0);

  function ask(kind: Kind) {
    turnSeen = view.game?.turn ?? 0;
    confirm = kind;
    sheet = false;
  }

  // If the situation changes while a dialog is open (turn passed, role handed over), close it.
  $effect(() => {
    if (confirm && !controls?.[confirm]) confirm = null;
    if (sheet && !any) sheet = false;
  });

  const text = $derived(
    confirm === "skip"
      ? confirmSkipText(name)
      : confirm === "remove"
        ? confirmRemoveText(name, view.status)
        : confirm === "transfer"
          ? confirmTransferText(name)
          : "",
  );

  function send() {
    if (confirm === "skip") {
      conn.sendHost({ type: "host", action: { type: "skipTurn", turn: turnSeen } });
    } else if (confirm === "remove") {
      conn.sendHost({ type: "host", action: { type: "removePlayer", playerId } });
    } else if (confirm === "transfer") {
      conn.sendHost({ type: "host", action: { type: "transferHost", playerId } });
    }
    confirm = null;
  }
</script>

{#if any}
  <button
    class="secondary menu"
    aria-label={`Aktionen für ${name}`}
    aria-haspopup="dialog"
    onclick={() => (sheet = true)}>⋯</button
  >
{/if}

{#if sheet && controls}
  <div class="overlay">
    <div class="sheet" role="dialog" aria-modal="true" aria-label={`Aktionen für ${name}`}>
      <h2>{name}</h2>
      {#if controls.skip}<button onclick={() => ask("skip")}>Zug überspringen</button>{/if}
      {#if controls.transfer}
        <button class="secondary" onclick={() => ask("transfer")}>Zum Host machen</button>
      {/if}
      {#if controls.remove}<button class="secondary" onclick={() => ask("remove")}>Entfernen</button>{/if}
      <button class="secondary" onclick={() => (sheet = false)}>Schließen</button>
    </div>
  </div>
{/if}

{#if confirm}
  <ConfirmDialog
    {text}
    confirmLabel={confirm === "skip"
      ? "Zug überspringen"
      : confirm === "remove"
        ? "Entfernen"
        : "Zum Host machen"}
    onconfirm={send}
    oncancel={() => (confirm = null)}
  />
{/if}

<style>
  .menu {
    padding: 0;
    font-size: 1.3rem;
    line-height: 1;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 15;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }
  .sheet {
    width: min(26rem, 100%);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px 14px 0 0;
  }
  .sheet h2 {
    margin: 0;
    font-size: 1.1rem;
  }
</style>
