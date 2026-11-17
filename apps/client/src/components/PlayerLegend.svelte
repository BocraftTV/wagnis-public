<script lang="ts">
  // The player list next to the map: color, name, team, presence, host, out, number of cards, and the host menu.
  import type { GameViewMessage, RoomView } from "@wagnis/shared";
  import type { GameConnection } from "../lib/connection.svelte.js";
  import { playerStatus } from "../lib/host.js";
  import { teamName, teamOfPlayer } from "../lib/teams.js";
  import HostMenu from "./HostMenu.svelte";

  let {
    view,
    game,
    conn,
    me,
    out,
    playerName,
    colorOf,
  }: {
    view: RoomView;
    game: GameViewMessage;
    conn: GameConnection;
    me: string;
    out: Set<string>;
    playerName: (id: string | null) => string;
    colorOf: (id: string | null) => string;
  } = $props();
</script>

<ul class="legend">
  {#each game.playerOrder as id (id)}
    {@const p = view.players.find((x) => x.id === id)}
    {@const status = playerStatus(game, id)}
    <li class:active={id === game.activePlayerId} class:out={out.has(id)}>
      <span class="swatch" style:background={colorOf(id)}></span>
      <span>{playerName(id)}{id === me ? " (du)" : ""}</span>
      {#if teamOfPlayer(game.teams, id)}
        <span class="out-label team-label">{teamName(teamOfPlayer(game.teams, id)!)}</span>
      {/if}
      <span class="presence" class:online={p?.connected}>{p?.connected ? "●" : "○"}</span>
      <span class="sr">{p?.connected ? "verbunden" : "getrennt"}</span>
      {#if p?.isHost}<span class="out-label">Host</span>{/if}
      {#if status === "removed"}<span class="out-label">entfernt</span>
      {:else if status === "eliminated"}<span class="out-label">ausgeschieden</span>{/if}
      <span class="cards-count">{game.handCounts[id] ?? 0} Karten</span>
      <HostMenu {view} {conn} playerId={id} />
    </li>
  {/each}
</ul>

<style>
  .team-label {
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    padding: 0 0.35rem;
  }
  .swatch {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    vertical-align: -0.1rem;
    margin-right: 0.3rem;
    flex: none; /* never squeezed away next to the team label: the shade tells the partners apart (plan 015) */
  }
  .cards-count {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .legend li.out {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .out-label {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .legend {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0.6rem 1rem 1rem;
  }
  .legend li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-height: 2.2rem;
    padding: 0.2rem 0.7rem;
    background: var(--panel);
    border: 1px solid transparent;
    border-radius: 1.1rem;
  }
  /* In the narrow side panel a long row wraps between its parts, not inside "0 Karten" or "Team A". */
  .legend li > span {
    white-space: nowrap;
  }
  .legend li.active {
    border-color: var(--accent);
  }
  .presence {
    color: var(--muted);
  }
  .presence.online {
    color: var(--ok);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  @media (orientation: landscape) {
    .legend {
      flex-direction: column;
      flex-wrap: nowrap;
      width: 13rem;
      padding: 0.8rem 1rem;
    }
  }
</style>
