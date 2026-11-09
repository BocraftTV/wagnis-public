<script lang="ts">
  // Phase `missionChoice` (plan 013): every player chooses one of two missions at the same time. Presentation only:
  // the view carries the two offers (only the own ones) and who has already chosen; the server decides everything.
  import type { GameViewMessage, RoomView } from "@wagnis/shared";
  import type { GameConnection } from "../lib/connection.svelte.js";
  import HostMenu from "./HostMenu.svelte";
  import { isSendLocked } from "../lib/fortify.js";
  import { skipMessage } from "../lib/host.js";
  import type { SendLock } from "../lib/fortify.js";
  import { choiceWaitText, missionText } from "../lib/missions.js";
  import type { MissionContext } from "../lib/missions.js";

  let {
    view,
    game,
    conn,
    ctx,
  }: { view: RoomView; game: GameViewMessage; conn: GameConnection; ctx: MissionContext } =
    $props();

  const offer = $derived(game.secret.missionOffer);
  const chosen = $derived(game.missionChoice?.chosen ?? []);
  // Everybody still in the game takes part (removed players do not).
  const total = $derived(game.playerOrder.filter((p) => !game.removedPlayerIds.includes(p)).length);
  const chosenText = $derived(choiceWaitText(chosen.length, total));
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? "?";

  // The choice is final: after tapping, lock both cards until the next snapshot or an error arrives.
  let lock = $state<SendLock | null>(null);
  const locked = $derived(isSendLocked(lock, view.version, conn.noticeCount));
  function choose(index: 0 | 1) {
    if (locked) return;
    lock = { version: view.version, errors: conn.noticeCount };
    conn.sendAction({ type: "chooseMission", index });
  }
</script>

<main class="choice">
  <h1>Mission wählen</h1>
  {#if offer}
    <p class="muted">
      Du bekommst zwei Missionen. Such dir eine aus – die Wahl ist endgültig, die andere wird
      verdeckt abgelegt. Zeig sie niemandem.
    </p>
    <div class="cards">
      {#each offer as mission, i (i)}
        <button class="card" disabled={locked} onclick={() => choose(i === 0 ? 0 : 1)}>
          <span class="no">Mission {i + 1}</span>
          <span class="text">{missionText(mission, ctx)}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="done" role="status">Du hast gewählt.</p>
  {/if}
  <p class="wait" role="status">{chosenText}</p>
  <ul class="who">
    {#each game.playerOrder.filter((p) => !game.removedPlayerIds.includes(p)) as id (id)}
      <li class:done={chosen.includes(id)}>
        {nameOf(id)}{id === view.you.playerId ? " (du)" : ""}: {chosen.includes(id)
          ? "hat gewählt"
          : "wählt noch"}
        <HostMenu {view} {conn} playerId={id} />
      </li>
    {/each}
  </ul>
  {#if view.you.isHost && chosen.length < total}
    <section class="host" aria-label="Host">
      <p class="muted">Wer nicht wählt, hält alle auf. Du kannst für alle, die noch nicht gewählt haben, zufällig wählen lassen.</p>
      <button class="secondary" onclick={() => conn.sendHost(skipMessage(game))}
        >Für alle Offenen zufällig wählen</button
      >
    </section>
  {/if}
</main>

<style>
  .choice {
    max-width: 36rem;
    margin: 0 auto;
    padding: 1rem;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }
  .cards {
    display: grid;
    gap: 0.8rem;
    margin: 1rem 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    min-height: 44px;
    padding: 1rem;
    text-align: left;
    background: var(--panel-2);
    color: inherit;
    border: 2px solid var(--line);
    border-radius: 12px;
    touch-action: manipulation;
  }
  .card:disabled {
    opacity: 0.6;
  }
  .no {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .text {
    font-size: 1.2rem;
    font-weight: 700;
  }
  .done,
  .wait {
    font-weight: 600;
  }
  .who {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    color: var(--muted);
  }
  .who li {
    padding: 0.2rem 0;
  }
  .host {
    margin-top: 1rem;
  }
  .who li.done {
    color: inherit;
  }
</style>
