<script lang="ts">
  import { isValidRoomId, normalizeRoomId } from "@wagnis/shared";
  import type { MapId } from "@wagnis/shared";
  import { createRoom } from "../lib/api.js";
  import { httpErrorText } from "../lib/messages.js";
  import { navigate } from "../lib/route.svelte.js";
  import { saveIdentity } from "../lib/storage.js";

  let code = $state("");
  let codeError = $state("");

  let hostName = $state("");
  let createCode = $state("");
  let createError = $state("");
  let creating = $state(false);
  // The map choice exists in the dev build only; the production build always creates the world map.
  const mapChoice = import.meta.env.DEV;
  let mapId = $state<MapId>("welt");

  function joinByCode(event: SubmitEvent) {
    event.preventDefault();
    const id = normalizeRoomId(code);
    if (!isValidRoomId(id)) {
      codeError = "Das ist kein gültiger Raumcode (6 Zeichen, z. B. K7M-2XQ).";
      return;
    }
    codeError = "";
    navigate(id);
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    creating = true;
    createError = "";
    const result = await createRoom(createCode, hostName, mapChoice ? mapId : undefined);
    creating = false;
    if (!result.ok) {
      createError = httpErrorText[result.code];
      return;
    }
    saveIdentity(result.data.roomId, {
      playerId: result.data.playerId,
      token: result.data.playerToken,
    });
    navigate(result.data.roomId);
  }
</script>

<main class="start">
  <h1>Wagnis</h1>

  <form class="card" onsubmit={joinByCode}>
    <h2>Raum beitreten</h2>
    <label for="room-code">Raumcode</label>
    <input
      id="room-code"
      bind:value={code}
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      placeholder="K7M-2XQ"
    />
    {#if codeError}<p class="error" role="alert">{codeError}</p>{/if}
    <p><button type="submit">Weiter</button></p>
  </form>

  <form class="card" onsubmit={create}>
    <h2>Raum erstellen</h2>
    <label for="host-name">Dein Name</label>
    <input id="host-name" bind:value={hostName} maxlength="16" autocomplete="off" />
    <label for="create-code">Erstell-Code</label>
    <input
      id="create-code"
      type="password"
      bind:value={createCode}
      autocomplete="off"
      autocapitalize="off"
    />
    {#if mapChoice}
      <label for="map-id">Karte (nur Entwicklung)</label>
      <select id="map-id" bind:value={mapId}>
        <option value="welt">Welt (42 Gebiete)</option>
        <option value="testland">testland (8 Gebiete)</option>
      </select>
    {/if}
    {#if createError}<p class="error" role="alert">{createError}</p>{/if}
    <p><button type="submit" disabled={creating}>Raum erstellen</button></p>
  </form>
</main>

<style>
  .start {
    max-width: 30rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  h1 {
    font-size: 2.2rem;
    letter-spacing: 0.04em;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 1rem 1.1rem 0.4rem;
    margin-top: 1.2rem;
  }
</style>
