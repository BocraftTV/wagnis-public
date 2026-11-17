<script lang="ts">
  // The end of the game: the winner banner, back to the lobby, the team score, the score after the round limit and
  // the resolution of the missions. All rows come ready from the game view; this only shows them.
  import type { GameViewMessage, RoomView } from "@wagnis/shared";
  import { backToLobbyMessage, canBackToLobby } from "../lib/host.js";
  import type { resolutionRows } from "../lib/missions.js";
  import { winnersText } from "../lib/rounds.js";
  import type { scoreRows } from "../lib/rounds.js";
  import { teamName, teamWinText } from "../lib/teams.js";
  import type { teamScoreRows, winningTeams } from "../lib/teams.js";
  import type { GameConnection } from "../lib/connection.svelte.js";

  let {
    view,
    game,
    conn,
    me,
    finished,
    winnerTeams,
    reasonText,
    teamRows,
    scores,
    resolution,
    playerName,
    colorOf,
  }: {
    view: RoomView;
    game: GameViewMessage;
    conn: GameConnection;
    me: string;
    finished: boolean;
    winnerTeams: ReturnType<typeof winningTeams>;
    reasonText: string | null;
    teamRows: ReturnType<typeof teamScoreRows>;
    scores: ReturnType<typeof scoreRows>;
    resolution: ReturnType<typeof resolutionRows>;
    playerName: (id: string | null) => string;
    colorOf: (id: string | null) => string;
  } = $props();
</script>

{#if finished && game.winnerId}
  <div class="winner" role="status">
    🏆 {game.winnerTeamId
      ? teamWinText(winnerTeams, game.winnerIds, playerName)
      : winnersText(game.winnerIds, game.winnerId, playerName, me)}{reasonText
      ? ` – ${reasonText}`
      : ""}
  </div>
{/if}

{#if finished}
  <section class="after" aria-label="Nach dem Spiel">
    {#if canBackToLobby(view)}
      <p class="muted">
        Alle kommen zurück in die Lobby und bleiben eingetragen; dort wählst du Karte und
          Siegmodus für die nächste Partie.
      </p>
      <button onclick={() => conn.sendHost(backToLobbyMessage())}>Zurück zur Lobby</button>
    {:else}
      <p class="muted" role="status">Warte auf den Host …</p>
    {/if}
  </section>
{/if}

{#if finished && teamRows.length > 0}
  <section class="resolution" aria-label="Teamwertung">
    <h2>Teamwertung</h2>
    <ul>
      {#each teamRows as row (row.teamId)}
        <li>
          <strong>{row.winner ? "🏆 " : ""}{teamName(row.teamId)}: {row.points} Punkte</strong>
          <span class="mission-line"
            >{row.members.map(playerName).join(", ")} · {row.armies} Armeen</span
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if finished && scores.length > 0}
  <section class="resolution" aria-label="Wertung">
    <h2>Wertung nach {game.round} Runden</h2>
    <ul>
      {#each scores as row (row.playerId)}
        <li>
          <span class="swatch" style:background={colorOf(row.playerId)}></span>
          <strong
            >{row.winner ? "🏆 " : ""}{playerName(row.playerId)}{row.playerId === me
              ? " (du)"
              : ""}: {row.points} Punkte</strong
          >
          <span class="mission-line">{row.detail}, {row.armies} Armeen</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if finished && resolution && resolution.length > 0}
  <section class="resolution" aria-label="Auflösung der Missionen">
    <h2>Auflösung</h2>
    <ul>
      {#each resolution as row (row.playerId)}
        <li>
          <span class="swatch" style:background={colorOf(row.playerId)}></span>
          <strong>{playerName(row.playerId)}{row.playerId === me ? " (du)" : ""}</strong>
          <span class="mission-line">{row.current}</span>
          {#if row.original}
            <span class="replaced-line">ersetzt: ursprünglich gezogen: {row.original}</span>
          {/if}
          {#if row.discarded}
            <span class="replaced-line">abgeworfen: {row.discarded}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .swatch {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    vertical-align: -0.1rem;
    margin-right: 0.3rem;
    flex: none; /* never squeezed away next to the team label: the shade tells the partners apart (plan 015) */
  }
  .after {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
  }
  .after p {
    margin: 0;
  }
  .winner {
    padding: 0.8rem 1rem;
    background: var(--accent);
    color: #1b1b1b;
    font-weight: 800;
    text-align: center;
  }
  .resolution {
    padding: 0.6rem 1rem;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .resolution h2 {
    font-size: 1rem;
  }
  .resolution ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
  }
  .resolution li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.1rem 0.5rem;
  }
  .mission-line {
    flex-basis: 100%;
  }
  .replaced-line {
    flex-basis: 100%;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .muted {
    color: var(--muted);
  }
</style>
