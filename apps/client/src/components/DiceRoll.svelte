<script lang="ts">
  import { diceFrames, pips } from "../lib/dice.js";
  import type { CombatRecord, Playback } from "../lib/dice.js";

  let {
    combat,
    playback,
    attackerColor,
    defenderColor,
  }: {
    combat: CombatRecord;
    playback: Playback;
    attackerColor: string;
    defenderColor: string;
  } = $props();

  // Decoration only: the result text is in the combat field from the start. The component is created per combat
  // (keyed by `seq` in the game view), so these values are read once.
  // svelte-ignore state_referenced_locally
  const frames = diceFrames(combat, playback);
  // svelte-ignore state_referenced_locally
  const tumbles = playback.mode === "single";
  let frame = $state.raw(frames[0]!);

  // One timeout per picture (at most 21), no loop and no per-frame work.
  $effect(() => {
    const handles = frames.slice(1).map((f) => setTimeout(() => (frame = f), f.atMs));
    return () => handles.forEach(clearTimeout);
  });

  const SIZE = 32;
  const ATTACKER_X = [6, 44, 82];
  const DEFENDER_X = [150, 188];
  const sixPips = [0, 1, 2, 3, 4, 5];
</script>

<svg class="dice" viewBox="0 0 226 64" aria-hidden="true" focusable="false">
  {#snippet die(face: number | null, x: number, color: string, slot: number)}
    <g class="die" class:tumble={tumbles} class:absent={face === null} style:animation-delay={`${slot * 40}ms`}>
      <rect class="body" {x} y="8" width={SIZE} height={SIZE} rx="6" style:stroke={color} />
      {#each sixPips as k (k)}
        {@const at = face === null ? undefined : pips(face)[k]}
        <circle
          class="pip"
          cx={x + (at ? at[0] * SIZE : SIZE / 2)}
          cy={8 + (at ? at[1] * SIZE : SIZE / 2)}
          r="3.4"
          opacity={at ? 1 : 0}
        />
      {/each}
    </g>
  {/snippet}
  {#each frame.attacker as face, i (i)}{@render die(face, ATTACKER_X[i]!, attackerColor, i)}{/each}
  <text class="vs" x="113" y="29" text-anchor="middle">gegen</text>
  {#each frame.defender as face, i (i)}{@render die(face, DEFENDER_X[i]!, defenderColor, i + 3)}{/each}
  <text class="loss" x="6" y="58">−{frame.attackerLosses}</text>
  <text class="loss" x="220" y="58" text-anchor="end">−{frame.defenderLosses}</text>
</svg>

<style>
  .dice {
    display: block;
    width: 100%;
    max-width: 22rem;
    height: auto;
    margin: 0.4rem 0;
  }
  .body {
    fill: #f4f4f4;
    stroke-width: 3;
  }
  .pip {
    fill: #111;
  }
  .absent {
    opacity: 0;
  }
  .vs,
  .loss {
    fill: var(--muted);
    font-size: 11px;
  }
  .loss {
    fill: var(--text);
    font-size: 13px;
    font-weight: 700;
  }
  .tumble {
    transform-box: fill-box;
    transform-origin: center;
    animation: tumble 600ms ease-out both;
  }
  @keyframes tumble {
    0% {
      transform: translateY(-14px) rotate(-120deg) scale(0.8);
      opacity: 0.2;
    }
    70% {
      transform: translateY(2px) rotate(12deg) scale(1.05);
      opacity: 1;
    }
    100% {
      transform: translateY(0) rotate(0deg) scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tumble {
      animation: none;
    }
  }
</style>
