<script lang="ts">
  // The combat result field (plan 008): the dice of the last roll, for blitz the summary, and the dice animation on
  // top. Which combat is shown and whether it is animated decides the game view; this field closes itself after
  // FIELD_MS and ends the animation after its length. A tap skips the animation first; the next tap closes the field.
  import type { GameViewMessage } from "@wagnis/shared";
  import { combatDisplay, pairDice } from "../lib/attack.js";
  import type { Playback } from "../lib/dice.js";
  import DiceRoll from "./DiceRoll.svelte";

  type Combat = NonNullable<GameViewMessage["lastCombat"]>;
  let {
    shown = $bindable(),
    playback = $bindable(),
    playerName,
    colorOf,
    territoryName,
  }: {
    shown: Combat | null;
    playback: Playback | null;
    playerName: (id: string | null) => string;
    colorOf: (id: string | null) => string;
    territoryName: (id: string) => string;
  } = $props();

  const FIELD_MS = 6000;
  $effect(() => {
    if (!playback) return;
    const h = setTimeout(() => (playback = null), playback.totalMs);
    return () => clearTimeout(h);
  });
  function tapField() {
    if (playback) playback = null;
    else shown = null;
  }
  $effect(() => {
    if (!shown) return;
    const h = setTimeout(() => (shown = null), FIELD_MS);
    return () => clearTimeout(h);
  });
  const display = $derived(shown ? combatDisplay(shown) : null);
</script>

{#if shown && display}
  <div
    class="combat"
    role="button"
    tabindex="0"
    aria-label="Kampfergebnis, antippen zum Schließen"
    onclick={tapField}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && tapField()}
  >
    <div class="combat-head">
      <span class="swatch" style:background={colorOf(shown.attackerId)}></span>
      <strong>{playerName(shown.attackerId)}</strong> greift
      <span class="swatch" style:background={colorOf(shown.defenderId)}></span>
      <strong>{playerName(shown.defenderId)}</strong> an: {territoryName(shown.from)} → {territoryName(
        shown.to,
      )}
    </div>
    {#if display.showSummary}
      <div class="combat-sum">
        Blitz: {display.rollCount} Würfe · Verluste Angreifer {shown.summary.attackerLosses},
        Verteidiger {shown.summary.defenderLosses} ·
        {shown.summary.conquered ? "erobert" : "nicht erobert"}
        {#if display.rollCount > shown.rolls.length}
          <span class="muted">(letzter Wurf:)</span>
        {/if}
      </div>
    {/if}
    {#if playback}
      {#key shown.seq}
        <DiceRoll
          combat={shown}
          {playback}
          attackerColor={colorOf(shown.attackerId)}
          defenderColor={colorOf(shown.defenderId)}
        />
      {/key}
      <div class="skip" aria-hidden="true">Antippen zum Überspringen</div>
    {/if}
    {#if display.roll}
      {#if !playback}
      <div class="pairs">
        {#each pairDice(display.roll) as p, i (i)}
          <div class="pair">
            <span class="die" class:lost={p.loser === "attacker"} class:none={p.attacker === null}
              >{p.attacker ?? ""}</span
            >
            <span class="vs">:</span>
            <span class="die" class:lost={p.loser === "defender"} class:none={p.defender === null}
              >{p.defender ?? ""}</span
            >
          </div>
        {/each}
      </div>
      {/if}
      <div class="losses">
        Verluste: Angreifer {display.roll.attackerLosses}, Verteidiger {display.roll
          .defenderLosses}{#if !display.showSummary && shown.summary.conquered}
          · erobert{/if}
      </div>
    {/if}
  </div>
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
  .combat {
    position: fixed;
    left: 50%;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 5;
    width: min(26rem, calc(100vw - 2rem));
    padding: 0.7rem 0.9rem;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .combat-head,
  .combat-sum,
  .losses {
    font-size: 0.95rem;
  }
  .combat-sum {
    margin-top: 0.3rem;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .skip {
    min-height: 1.4rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pairs {
    display: flex;
    gap: 0.6rem;
    margin: 0.5rem 0;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .die {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 8px;
    background: #f4f4f4;
    color: #111;
    font-weight: 800;
    font-size: 1.3rem;
  }
  .die.lost {
    opacity: 0.3;
    filter: grayscale(1);
  }
  .die.none {
    background: transparent;
    border: 1px dashed var(--line);
  }
  .vs {
    color: var(--muted);
  }
</style>
