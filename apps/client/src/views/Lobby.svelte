<script lang="ts">
  import { formatRoomId } from "@wagnis/shared";
  import type { RoomView } from "@wagnis/shared";
  import type { GameConnection } from "../lib/connection.svelte.js";
  import ChoiceGroup from "../components/ChoiceGroup.svelte";
  import HostMenu from "../components/HostMenu.svelte";
  import QrCode from "../components/QrCode.svelte";
  import { randomTeamsMessage, settingsMessage, teamMessage } from "../lib/host.js";
  import {
    assignmentHint,
    teamLetters,
    teamModeButton,
    teamModeChoices,
    teamModeHint,
    teamModeLabel,
    teamName,
    teamsSectionLabel,
  } from "../lib/teams.js";
  import {
    fortifyHint,
    fortifyLabel,
    mapLabel,
    holdToWinHint,
    holdToWinLabel,
    mapOptions,
    missionDraftHint,
    missionDraftLabel,
    modeHint,
    modeLabel,
  } from "../lib/mapname.js";
  import { worldEventsHint, worldEventsLabel } from "../lib/events.js";
  import { ownerColor } from "../lib/owner.js";
  import { qrHint, qrTarget } from "../lib/qr/target.js";
  import {
    roundLimitChoices,
    roundLimitHint,
    roundLimitLabel,
    roundLimitSectionLabel,
  } from "../lib/rounds.js";

  const modes = ["missions", "domination"] as const;
  const moveChoices = [1, 2] as const;
  /** A switch as two buttons: off first, then on. */
  const onOff = (off: string, on: string) => [
    { value: false, label: off },
    { value: true, label: on },
  ];
  // testland is offered in a development build only
  const maps = mapOptions(import.meta.env.DEV);

  let { view, conn }: { view: RoomView; conn: GameConnection } = $props();

  // The QR code points to the public address if the server has one, else to this page's origin (rules.md 10.5).
  const target = $derived(
    qrTarget({ pageUrl: location.href, publicUrl: view.publicUrl, roomId: view.roomId }),
  );
  const link = $derived(target.kind === "url" ? target.url : `${location.origin}/r/${view.roomId}`);
  let big = $state(false);
  let innerWidth = $state(800);
  let innerHeight = $state(800);
  let copyState = $state<"idle" | "done" | "failed">("idle");
  // What is still missing for the chosen team layout (a note for the host; the server checks at the start).
  const teamNote = $derived(
    assignmentHint(
      view.teams,
      view.players.map((p) => p.team),
    ),
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      copyState = "done";
    } catch {
      copyState = "failed";
    }
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<main class="lobby">
  <h1>Lobby</h1>
  <p class="code" aria-label="Raumcode">{formatRoomId(view.roomId)}</p>
  <p class="row">
    <button class="secondary" onclick={copyLink}>Link kopieren</button>
    {#if copyState === "done"}<span class="ok" role="status">Kopiert</span>{/if}
  </p>
  {#if copyState === "failed"}
    <p class="muted">Kopieren nicht möglich. Link zum Weitergeben:</p>
    <input readonly value={link} onfocus={(e) => e.currentTarget.select()} />
  {/if}

  {#if target.kind === "url"}
    <section class="qr" aria-label="QR-Code zum Beitreten">
      <div class="tile">
        <QrCode
          text={target.url}
          available={Math.min(340, innerWidth - 64)}
          label="QR-Code mit der Adresse dieses Raums"
        />
      </div>
      <p class="muted addr">{target.url}</p>
      <button class="secondary" onclick={() => (big = true)}>Groß anzeigen</button>
    </section>
  {:else}
    <p class="muted" role="note">{qrHint(target.kind)}</p>
  {/if}

  {#if view.you.isHost}
    <!-- The choice always shows the last snapshot: no local anticipation. -->
    <section aria-label="Siegmodus">
      <h2>Siegmodus</h2>
      <ChoiceGroup
        label="Siegmodus"
        options={modes.map((m) => ({ value: m, label: modeLabel(m) }))}
        selected={view.victoryMode}
        hint={modeHint(view.victoryMode)}
        onpick={(m) => conn.sendHost(settingsMessage({ victoryMode: m }))}
      />
    </section>
    <section aria-label="Karte">
      <h2>Karte</h2>
      <ChoiceGroup
        label="Karte"
        options={maps.map((m) => ({ value: m.id, label: m.label }))}
        selected={view.mapId}
        hint={mapLabel(view.mapId)}
        onpick={(id) => conn.sendHost(settingsMessage({ mapId: id }))}
      />
    </section>
    <section aria-label="Verschiebungen pro Zug">
      <h2>Verschiebungen pro Zug</h2>
      <ChoiceGroup
        label="Verschiebungen pro Zug"
        options={moveChoices.map((m) => ({ value: m, label: fortifyLabel(m) }))}
        selected={view.fortifyMoves}
        hint={fortifyHint(view.fortifyMoves)}
        onpick={(m) => conn.sendHost(settingsMessage({ fortifyMoves: m }))}
      />
    </section>
    <section aria-label={roundLimitSectionLabel}>
      <h2>{roundLimitSectionLabel}</h2>
      <ChoiceGroup
        label={roundLimitSectionLabel}
        options={roundLimitChoices.map((r) => ({ value: r, label: r === null ? "Aus" : String(r) }))}
        selected={view.roundLimit}
        hint={roundLimitHint(view.roundLimit)}
        onpick={(r) => conn.sendHost(settingsMessage({ roundLimit: r }))}
      />
    </section>
    <section aria-label={teamsSectionLabel}>
      <h2>{teamsSectionLabel}</h2>
      <ChoiceGroup
        label={teamsSectionLabel}
        options={teamModeChoices.map((m) => ({ value: m, label: teamModeButton(m) }))}
        selected={view.teams}
        hint={teamModeHint(view.teams)}
        onpick={(m) => conn.sendHost(settingsMessage({ teams: m }))}
      />
      {#if view.teams !== null}
        <p>
          <button class="secondary" onclick={() => conn.sendHost(randomTeamsMessage())}>
            Zufällig zuteilen
          </button>
        </p>
        {#if teamNote}<p class="muted" role="status">{teamNote}</p>{/if}
      {/if}
    </section>
    <section aria-label={worldEventsLabel}>
      <h2>{worldEventsLabel}</h2>
      <ChoiceGroup
        label={worldEventsLabel}
        options={onOff("Aus", "An")}
        selected={view.worldEvents}
        hint={worldEventsHint(view.worldEvents)}
        onpick={(on) => conn.sendHost(settingsMessage({ worldEvents: on }))}
      />
    </section>
    {#if view.victoryMode === "missions"}
      <section aria-label="Missions-Optionen">
        <h2>Missionen</h2>
        <ChoiceGroup
          label={missionDraftLabel}
          options={onOff("Eine Mission", missionDraftLabel)}
          selected={view.missionDraft}
          hint={missionDraftHint(view.missionDraft)}
          onpick={(on) => conn.sendHost(settingsMessage({ missionDraft: on }))}
        />
        <ChoiceGroup
          label={holdToWinLabel}
          options={onOff("Sofortiger Sieg", holdToWinLabel)}
          selected={view.holdToWin}
          hint={holdToWinHint(view.holdToWin)}
          onpick={(on) => conn.sendHost(settingsMessage({ holdToWin: on }))}
        />
      </section>
    {/if}
  {:else}
    <p class="map">Siegmodus: {modeLabel(view.victoryMode)}</p>
    <p class="muted">{modeHint(view.victoryMode)}</p>
    <p class="map">{mapLabel(view.mapId)}</p>
    <p class="map">Verschiebungen: {fortifyLabel(view.fortifyMoves)}</p>
    <p class="muted">{fortifyHint(view.fortifyMoves)}</p>
    <p class="map">Rundenlimit: {roundLimitLabel(view.roundLimit)}</p>
    <p class="muted">{roundLimitHint(view.roundLimit)}</p>
    <p class="map">{teamsSectionLabel}: {teamModeLabel(view.teams)}</p>
    <p class="muted">{teamModeHint(view.teams)}</p>
    <p class="map">{worldEventsLabel}: {view.worldEvents ? "An" : "Aus"}</p>
    <p class="muted">{worldEventsHint(view.worldEvents)}</p>
    {#if view.victoryMode === "missions"}
      <p class="map">Missionen: {view.missionDraft ? missionDraftLabel : "Eine Mission"}</p>
      <p class="muted">{missionDraftHint(view.missionDraft)}</p>
      <p class="map">Sieg: {view.holdToWin ? holdToWinLabel : "Sofortiger Sieg"}</p>
      <p class="muted">{holdToWinHint(view.holdToWin)}</p>
    {/if}
  {/if}

  <h2>Spieler ({view.players.length}/6)</h2>
  <ul class="players">
    {#each view.players as p (p.id)}
      <li>
        <span class="swatch" style:background={ownerColor(p.id, view.players)}></span>
        <span class="name">
          {p.name}{p.id === view.you.playerId ? " (du)" : ""}
          {#if p.isHost}<span class="tag">Host</span>{/if}
        </span>
        {#if view.teams !== null && !view.you.isHost}
          <span class="tag">{p.team ? teamName(p.team) : "ohne Team"}</span>
        {/if}
        {#if view.teams !== null && view.you.isHost}
          <span class="teampick" role="group" aria-label={`Team von ${p.name}`}>
            {#each teamLetters(view.teams) as letter (letter)}
              <button
                class="teambtn"
                class:secondary={p.team !== letter}
                aria-pressed={p.team === letter}
                onclick={() => conn.sendHost(teamMessage(p.id, p.team === letter ? null : letter))}
                >{letter}</button
              >
            {/each}
          </span>
        {/if}
        <span class="presence" class:online={p.connected}>
          {p.connected ? "verbunden" : "getrennt"}
        </span>
        <HostMenu {view} {conn} playerId={p.id} />
      </li>
    {/each}
  </ul>

  {#if view.you.isHost}
    <p>
      <button disabled={view.players.length < 2 || teamNote !== null} onclick={() => conn.sendStart()}>
        Partie starten
      </button>
    </p>
    {#if view.players.length < 2}<p class="muted">Zum Starten braucht es mindestens 2 Spieler.</p>{/if}
  {:else}
    <p class="muted">Warte darauf, dass der Host die Partie startet …</p>
  {/if}

  {#if conn.notice}<p class="error" role="alert">{conn.notice}</p>{/if}
</main>

{#if big && target.kind === "url"}
  <div class="overlay">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="QR-Code groß">
      <div class="tile">
        <QrCode
          text={target.url}
          available={Math.min(innerWidth, innerHeight) - 160}
          label="QR-Code mit der Adresse dieses Raums"
        />
      </div>
      <p class="muted addr">{target.url}</p>
      <button onclick={() => (big = false)}>Schließen</button>
    </div>
  </div>
{/if}

<style>
  .teampick {
    display: inline-flex;
    gap: 0.25rem;
  }
  .teambtn {
    min-width: var(--tap);
    min-height: var(--tap);
    padding: 0 0.6rem;
  }
  .lobby {
    max-width: 34rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  .code {
    font-size: 2.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    margin: 0.2rem 0 0.6rem;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .qr {
    margin: 0.4rem 0 1rem;
  }
  .tile {
    display: inline-block;
    line-height: 0;
    border-radius: 10px;
    overflow: hidden;
  }
  .addr {
    margin: 0.4rem 0 0.6rem;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    max-width: 100%;
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .map {
    margin: 0 0 1rem;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .ok {
    color: var(--ok);
  }
  .players {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
  }
  .players li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: var(--tap);
    padding: 0.4rem 0.8rem;
    margin-bottom: 0.4rem;
    background: var(--panel);
    border-radius: 10px;
  }
  .swatch {
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    flex: none;
  }
  .name {
    flex: 1;
  }
  .tag {
    margin-left: 0.4rem;
    padding: 0.1rem 0.45rem;
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--muted);
    font-size: 0.8rem;
  }
  .presence {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .presence.online {
    color: var(--ok);
  }
</style>
