<script lang="ts">
  import { formatRoomId } from "@wagnis/shared";
  import { joinRoom } from "../lib/api.js";
  import { httpErrorText } from "../lib/messages.js";
  import { navigate } from "../lib/route.svelte.js";
  import type { StoredIdentity } from "../lib/storage.js";

  let {
    roomId,
    note = "",
    onjoined,
  }: { roomId: string; note?: string; onjoined: (identity: StoredIdentity) => void } = $props();

  let name = $state("");
  let error = $state("");
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    const result = await joinRoom(roomId, name);
    busy = false;
    if (!result.ok) {
      error = httpErrorText[result.code];
      return;
    }
    onjoined({ playerId: result.data.playerId, token: result.data.playerToken });
  }
</script>

<main class="join">
  <h1>Raum {formatRoomId(roomId)}</h1>
  {#if note}<p class="error" role="alert">{note}</p>{/if}
  <form onsubmit={submit}>
    <label for="join-name">Dein Name</label>
    <input id="join-name" bind:value={name} maxlength="16" autocomplete="off" />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="row">
      <button type="submit" disabled={busy}>Beitreten</button>
      <button type="button" class="secondary" onclick={() => navigate(null)}>Zurück</button>
    </p>
  </form>
</main>

<style>
  .join {
    max-width: 30rem;
    margin: 0 auto;
    padding: 1.5rem 1rem;
  }
  .row {
    display: flex;
    gap: 0.6rem;
  }
</style>
