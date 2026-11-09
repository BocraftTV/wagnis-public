<script lang="ts">
  import { GameConnection } from "../lib/connection.svelte.js";
  import { clearIdentity, loadIdentity, saveIdentity } from "../lib/storage.js";
  import type { StoredIdentity } from "../lib/storage.js";
  import Game from "./Game.svelte";
  import JoinForm from "./JoinForm.svelte";
  import Lobby from "./Lobby.svelte";

  let { roomId }: { roomId: string } = $props();

  // Room is remounted per room id via {#key}, so the initial value is the right one.
  // svelte-ignore state_referenced_locally
  let identity = $state<StoredIdentity | null>(loadIdentity(roomId));
  let note = $state("");

  const conn = new GameConnection((reason) => {
    clearIdentity(roomId);
    identity = null;
    note =
      reason === "removed"
        ? "Der Host hat dich aus dem Raum entfernt."
        : "Dein Zugang ist ungültig oder der Raum ist nicht mehr vorhanden. Bitte neu beitreten.";
  });

  $effect(() => {
    if (!identity) return;
    conn.start(roomId, identity.token);
    const onVisibility = () =>
      conn.onVisibilityChange(document.visibilityState === "visible", Date.now());
    const onOnline = () => conn.onOnline();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      conn.stop();
    };
  });

  function joined(id: StoredIdentity) {
    saveIdentity(roomId, id);
    note = "";
    identity = id;
  }
</script>

{#if !identity}
  <JoinForm {roomId} {note} onjoined={joined} />
{:else}
  {#if conn.status === "reconnecting"}
    <div class="banner" role="status">Verbindung wird wiederhergestellt …</div>
  {/if}

  {#if conn.status === "replaced"}
    <main class="center">
      <h1>In einem anderen Fenster geöffnet</h1>
      <p>Dieser Raum ist mit deinem Zugang in einem anderen Fenster aktiv.</p>
      <button onclick={() => conn.resume()}>Hier fortsetzen</button>
    </main>
  {:else if conn.view}
    {#if conn.view.status === "lobby" || !conn.view.game}
      <Lobby view={conn.view} {conn} />
    {:else}
      <Game view={conn.view} game={conn.view.game} {conn} />
    {/if}
  {:else}
    <main class="center"><p>Verbinde …</p></main>
  {/if}
{/if}

<style>
  .banner {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 0.7rem 1rem;
    background: var(--danger);
    color: #1b1b1b;
    font-weight: 700;
    text-align: center;
  }
  .center {
    max-width: 30rem;
    margin: 0 auto;
    padding: 2rem 1rem;
    text-align: center;
  }
</style>
