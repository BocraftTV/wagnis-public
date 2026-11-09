<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { segmentsPath } from "../lib/borders.js";
  import { effectiveHit } from "../lib/hit.js";
  import type { TerritoryMark } from "../lib/mark.js";
  import { armiesText, territoryHint } from "../lib/hint.js";
  import { COUNTER_RADIUS_PX } from "../lib/layers.js";
  import {
    BADGE_GAP_PX,
    BADGE_PX,
    CONTINENT_LINE_PX,
    continentLabelLines,
    continentLabelWidth,
    labelLines,
    LABEL_FONT_PX,
    LABEL_LINE_PX,
  } from "../lib/label.js";
  import { GestureTracker, isDoubleTap, keyAction, wheelFactor } from "../lib/gestures.js";
  import {
    clamp,
    DEFAULT_LIMITS,
    doubleTap,
    fitScale,
    fitViewport,
    labelVisible,
    refit,
    zoomAt,
  } from "../lib/viewport.js";
  import type { Point, PointerSample, Size, Viewport } from "../lib/viewport.js";
  import MapBackdrop from "./MapBackdrop.svelte";
  import MapControls from "./MapControls.svelte";
  import MapDefs from "./MapDefs.svelte";
  import type { Terrain } from "../maps/decor.js";
  import type { MapData } from "../maps/index.js";

  interface Props {
    data: MapData;
    territories: Record<string, { ownerId: string | null; armies: number | null }>;
    marks: Record<string, TerritoryMark>;
    /** Territories flashed briefly after a combat. */
    flash: readonly string[];
    ownerName: (id: string | null) => string;
    ownerColor: (id: string | null) => string;
    ontap: (territoryId: string) => void;
    /** Storm (plan 014 B): the sea routes are closed and drawn faded. */
    seaClosed?: boolean;
    /** The continent the round's event is about (goldRush, plague, truce): its name is marked. */
    eventContinent?: string | null;
  }

  let {
    data,
    territories,
    marks,
    flash,
    ownerName,
    ownerColor,
    ontap,
    seaClosed = false,
    eventContinent = null,
  }: Props = $props();

  const layout = $derived(data.layout);
  const names = $derived(Object.fromEntries(data.map.territories.map((t) => [t.id, t.name])));
  const continentNames = $derived(Object.fromEntries(data.map.continents.map((c) => [c.id, c])));

  // Container size from the ResizeObserver; the viewport maps map units to container pixels.
  let stage = $state<HTMLElement>();
  let size = $state<Size>({ width: 0, height: 0 });
  let vp = $state.raw<Viewport>({ scale: 1, tx: 0, ty: 0 });
  let sized = false;

  $effect(() => {
    const el = stage;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width <= 0 || next.height <= 0) return;
      if (!sized) vp = fitViewport(next, layout.viewBox, 8);
      else vp = refit(vp, size, next, layout.viewBox);
      sized = true;
      size = next;
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Another map (a different room) starts at the fit view again.
  $effect(() => {
    const box = layout.viewBox;
    untrack(() => {
      if (sized) vp = fitViewport(size, box, 8);
    });
  });

  // Derived values only change when their value does, so a pan rewrites the world group alone.
  const s = $derived(vp.scale);
  const fit = $derived(fitScale(size, layout.viewBox, 8));
  const showNames = $derived(labelVisible(vp, fit, layout.labelZoom));

  // Last tapped territory: its name stays visible and the hint strip names it.
  let inspected = $state<string | null>(null);
  function tapped(id: string) {
    inspected = id;
    ontap(id);
  }
  const hint = $derived.by(() => {
    const t = inspected ? territories[inspected] : undefined;
    return inspected && t ? territoryHint(names[inspected] ?? inspected, ownerName(t.ownerId), t.armies) : "";
  });

  function nameShown(id: string): boolean {
    return showNames || id === inspected || marks[id]?.ring === "chosen";
  }

  /** Dash-dot pattern of the sea routes in screen px. */
  const ROUTE_DASH = [8, 5, 1.5, 5];
  const borderPath = $derived(segmentsPath(layout.continentBorders));
  const terrains = $derived(Object.keys(layout.terrainPaths) as Terrain[]);

  // Viewport changes are bundled per animation frame; the world group is the only element that moves on a pan.
  let pending: Viewport | null = null;
  let frame = 0;
  function show(next: Viewport) {
    pending = next;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) vp = pending;
      pending = null;
    });
  }
  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
  });
  const limit = (v: Viewport) => clamp(v, size, layout.viewBox);
  const current = () => pending ?? vp;
  const center = (): Point => ({ x: size.width / 2, y: size.height / 2 });
  function zoomBy(factor: number, focal: Point = center()) {
    show(limit(zoomAt(current(), focal, factor)));
  }
  const fitView = () => show(fitViewport(size, layout.viewBox, DEFAULT_LIMITS.inset));
  const canZoomIn = $derived(s < fit * DEFAULT_LIMITS.maxZoom - 1e-9);
  const canZoomOut = $derived(s > fit + 1e-9);

  const tracker = new GestureTracker((v) => limit(v));
  let lastSeaTap: PointerSample | null = null;

  // Pointer events for touch, pen and mouse. The map has `touch-action: none`, so Safari neither scrolls nor zooms
  // the page there; pointer capture starts only once a drag begins, so taps stay ordinary clicks.
  $effect(() => {
    const el = stage;
    if (!el) return;
    const local = (e: PointerEvent | WheelEvent): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const sample = (e: PointerEvent): PointerSample => ({ ...local(e), t: e.timeStamp });
    const captured = new Set<number>();
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      tracker.down(e.pointerId, sample(e), current());
    };
    const move = (e: PointerEvent) => {
      const r = tracker.move(e.pointerId, local(e));
      if (!r) return;
      if (!captured.has(e.pointerId)) {
        captured.add(e.pointerId);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // The pointer is gone already; the drag ends with its up event.
        }
      }
      show(r.viewport);
    };
    const up = (e: PointerEvent) => {
      captured.delete(e.pointerId);
      const smp = sample(e);
      const { tap } = tracker.up(e.pointerId, smp, current());
      // A tap on open sea (no territory under it) is half of a double tap.
      if (!tap || (e.target as Element).closest("[data-tid]")) return;
      if (isDoubleTap(lastSeaTap, smp)) {
        lastSeaTap = null;
        show(doubleTap(current(), smp, size, layout.viewBox));
      } else lastSeaTap = smp;
    };
    const cancel = (e: PointerEvent) => {
      captured.delete(e.pointerId);
      tracker.up(e.pointerId, { ...sample(e), t: Number.POSITIVE_INFINITY }, current());
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(wheelFactor(e.deltaY, e.ctrlKey), local(e));
    };
    // Safari's own pinch events: without this the page itself zooms.
    const stop = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if (e.target !== el) return;
      const a = keyAction(e.key);
      if (!a) return;
      e.preventDefault();
      if (a.kind === "zoom") zoomBy(a.factor);
      else if (a.kind === "fit") fitView();
      else show(limit({ ...current(), tx: current().tx + a.dx, ty: current().ty + a.dy }));
    };
    const click = (e: MouseEvent) => {
      if (tracker.suppressClick) return;
      const id = (e.target as Element).closest("[data-tid]")?.getAttribute("data-tid");
      if (id) tapped(id);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", key);
    el.addEventListener("click", click);
    for (const t of ["gesturestart", "gesturechange", "gestureend"]) {
      el.addEventListener(t, stop, { passive: false });
    }
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", key);
      el.removeEventListener("click", click);
      for (const t of ["gesturestart", "gesturechange", "gestureend"]) el.removeEventListener(t, stop);
    };
  });
</script>

<div class="canvas">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the map takes focus for the keys + - 0 and arrows -->
  <div class="stage" bind:this={stage} role="application" aria-label="Karte" tabindex="0">
    {#if size.width > 0}
      <svg width={size.width} height={size.height}>
        <MapDefs
          atlas={layout.atlas}
          width={layout.viewBox.width}
          height={layout.viewBox.height}
          {terrains}
        />
        <g transform={`translate(${vp.tx} ${vp.ty}) scale(${s})`}>
          <MapBackdrop {layout} />
          <g class="halo">
            <path class="halo-wide" d={layout.allPath} />
            <path class="halo-narrow" d={layout.allPath} />
          </g>
          <g class="polygons">
            {#each layout.stack as id (id)}
              {@const owner = territories[id]?.ownerId ?? null}
              <path
                class="poly"
                data-tid={id}
                d={layout.paths[id]!}
                fill={ownerColor(owner)}
              />
            {/each}
          </g>
          <g class="texture">
            {#each terrains as kind (kind)}
              <path class="terrain" d={layout.terrainPaths[kind]} fill={`url(#map-pattern-${kind})`} />
            {/each}
            <path d={layout.allPath} fill="url(#map-light)" />
            {#if layout.atlas}
              {#each Object.entries(layout.continentPaths) as [cid, d] (cid)}
                <path class="tone" {d} style={`fill: var(--continent-${cid})`} />
              {/each}
            {/if}
          </g>
          <g class="lines">
            <path class="rim" d={layout.allPath} />
            <path class="border" d={layout.allPath} />
            <path class="continent-border" d={borderPath} />
            <path class="continent-border-light" d={borderPath} />
            <path class="coast" d={layout.coastPath} />
          </g>
          <!-- Sea routes: paper underlay, then the dash-dot line. Widths follow the zoom (two paths, rewritten per
               step) because the dash pattern of non-scaling-stroke is not the same in every engine. -->
          <g class="links" class:closed={seaClosed}>
            {#each [layout.routeDashed, layout.routeSolid] as d, i (i)}
              {#if d}
                <path class="link-under" {d} stroke-width={3.6 / s} />
                <path
                  class="link"
                  {d}
                  stroke-width={1.6 / s}
                  stroke-dasharray={i === 0 ? ROUTE_DASH.map((n) => n / s).join(" ") : undefined}
                />
              {/if}
            {/each}
          </g>
          <g class="hits">
            {#each layout.stack as id (id)}
              {@const c = effectiveHit(layout.territories[id]!.anchor, layout.territories[id]!.hit, s)}
              <circle class="hit" data-tid={id} cx={c.cx} cy={c.cy} r={c.r} />
            {/each}
          </g>
          <g class="rings">
            {#each layout.stack as id (id)}
              {@const m = marks[id]}
              {#if m && m.ring !== "none"}
                {@const t = layout.territories[id]!}
                <g transform={`translate(${t.anchor.x} ${t.anchor.y}) scale(${1 / s})`}>
                  <circle class="ring-under" r="22" />
                  <circle
                    class="ring {m.tone}"
                    class:chosen={m.ring === "chosen"}
                    r="22"
                  />
                </g>
              {/if}
            {/each}
          </g>
          <g class="counters">
            {#each layout.stack as id (id)}
              {@const t = layout.territories[id]!}
              {@const st = territories[id]}
              {@const m = marks[id]}
              {#if st}
                <g
                  class="counter"
                  data-tid={id}
                  transform={`translate(${t.anchor.x} ${t.anchor.y}) scale(${1 / s})`}
                  role="button"
                  tabindex={m?.pickable ? 0 : -1}
                  aria-label={`${names[id]}, ${ownerName(st.ownerId)}, ${armiesText(st.armies)}`}
                  aria-disabled={!m?.pickable}
                  aria-pressed={m?.ring === "chosen"}
                  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), tapped(id))}
                >
                  <circle
                    class="flash"
                    class:on={flash.includes(id)}
                    r={COUNTER_RADIUS_PX + 10}
                  />
                  <!-- Coin: ink edge, 3 px ring in the owner color, ink line, parchment field. -->
                  <circle class="coin-edge" r={COUNTER_RADIUS_PX} />
                  <circle r={COUNTER_RADIUS_PX - 1} fill={ownerColor(st.ownerId)} />
                  <circle class="coin-edge" r={COUNTER_RADIUS_PX - 4} />
                  <circle class="coin-field" r={COUNTER_RADIUS_PX - 5} />
                  <circle class="focus" r={COUNTER_RADIUS_PX + 2} />
                  <text class="armies" class:wide={(st.armies ?? 0) >= 100} text-anchor="middle" dominant-baseline="central">
                    {st.armies ?? "?"}
                  </text>
                </g>
              {/if}
            {/each}
          </g>
          <g class="labels">
            {#each Object.entries(layout.continentLabels) as [cid, p] (cid)}
              {@const c = continentNames[cid]}
              {#if c}
                {@const lines = continentLabelLines(c.name)}
                {@const tw = continentLabelWidth(lines)}
                <g transform={`translate(${p.x} ${p.y}) scale(${1 / s})`}>
                  <text
                    class="continent"
                    class:event={cid === eventContinent}
                    x={-(BADGE_PX + BADGE_GAP_PX) / 2}
                    text-anchor="middle"
                    dominant-baseline="central"
                  >
                    {#each lines as line, i (i)}
                      <tspan
                        x={-(BADGE_PX + BADGE_GAP_PX) / 2}
                        y={(i - (lines.length - 1) / 2) * CONTINENT_LINE_PX}
                      >
                        {line.toUpperCase()}
                      </tspan>
                    {/each}
                  </text>
                  <g transform={`translate(${tw / 2 + BADGE_GAP_PX / 2} 0)`}>
                    <circle class="badge" r={BADGE_PX / 2} />
                    <text class="badge-text" text-anchor="middle" dominant-baseline="central">
                      +{c.bonus}
                    </text>
                  </g>
                </g>
              {/if}
            {/each}
            {#each layout.stack as id (id)}
              {#if nameShown(id)}
                {@const t = layout.territories[id]!}
                <g transform={`translate(${t.anchor.x} ${t.anchor.y}) scale(${1 / s})`}>
                  {#if t.label.leader}
                    <line class="leader" x1="0" y1="0" x2={t.label.dx} y2={t.label.dy} />
                  {/if}
                  <text
                    class="label"
                    transform={`translate(${t.label.dx} ${t.label.dy + LABEL_FONT_PX - 1})`}
                    text-anchor={t.label.align}
                  >
                    {#each labelLines(names[id] ?? id) as line, i (i)}
                      <tspan x="0" dy={i === 0 ? 0 : LABEL_LINE_PX}>{line}</tspan>
                    {/each}
                  </text>
                </g>
              {/if}
            {/each}
          </g>
        </g>
      </svg>
    {/if}
    <div class="hint" aria-live="polite" class:empty={hint === ""}>{hint}</div>
  </div>
  <MapControls
    {canZoomIn}
    {canZoomOut}
    onzoomin={() => zoomBy(1.5)}
    onzoomout={() => zoomBy(1 / 1.5)}
    onfit={fitView}
  />
</div>

<style>
  /* Fills its frame (the parent sets the size); absolute, so no percentage height depends on an aspect ratio. */
  .canvas {
    position: absolute;
    inset: 0;
  }
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--map-paper);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    outline: none;
  }
  .stage:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  svg {
    display: block;
  }
  /* Line widths are screen px (non-scaling-stroke), so a zoom step rewrites no stroke width. */
  .halo {
    pointer-events: none;
  }
  .halo-wide,
  .halo-narrow {
    fill: none;
    stroke: var(--map-halo);
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .halo-wide {
    stroke-width: 8px;
    stroke-opacity: 0.25;
  }
  .halo-narrow {
    stroke-width: 4px;
    stroke-opacity: 0.45;
  }
  .texture,
  .lines {
    pointer-events: none;
  }
  .terrain {
    opacity: 0.3;
  }
  .tone {
    opacity: 0.12;
  }
  .rim,
  .border,
  .continent-border,
  .continent-border-light,
  .coast {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  /* Inner light edge: the line sits on the outline, so both sides get the same pale rim. */
  .rim {
    stroke: var(--map-light);
    stroke-width: 2.5px;
    stroke-opacity: 0.3;
  }
  .border {
    stroke: var(--map-border);
    stroke-width: 1px;
  }
  .continent-border {
    stroke: var(--map-continent-border);
    stroke-width: 3px;
  }
  .continent-border-light {
    stroke: var(--map-light);
    stroke-width: 1px;
    stroke-opacity: 0.7;
  }
  .coast {
    stroke: var(--map-continent-border);
    stroke-width: 1.2px;
  }
  .link-under,
  .link {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .link-under {
    stroke: var(--map-paper);
    stroke-opacity: 0.55;
  }
  .link {
    stroke: var(--map-sea-route);
  }
  /* Storm: the routes are closed, drawn faded and in the warning color. */
  .closed .link {
    stroke: var(--danger);
    stroke-opacity: 0.55;
  }
  .closed .link-under {
    stroke-opacity: 0.2;
  }
  .continent.event {
    fill: var(--accent);
    font-weight: 800;
    text-decoration: underline;
  }
  .hit {
    fill: transparent;
  }
  .rings,
  .labels {
    pointer-events: none;
  }
  .counter {
    outline: none;
    cursor: pointer;
  }
  .counter[aria-disabled="true"] {
    cursor: default;
  }
  .coin-edge {
    fill: var(--map-ink);
  }
  .coin-field {
    fill: var(--map-counter-field);
  }
  .focus {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3px;
    opacity: 0;
  }
  .counter:focus-visible .focus {
    opacity: 1;
  }
  .armies {
    fill: var(--map-counter-ink);
    font-size: 16px;
    font-weight: 700;
    pointer-events: none;
  }
  .armies.wide {
    font-size: 11px;
  }
  .ring,
  .ring-under {
    fill: none;
    stroke-width: 3;
  }
  .ring-under {
    stroke: var(--map-ring-under);
    stroke-width: 6;
  }
  .ring {
    stroke: var(--accent);
    stroke-dasharray: 6 4;
  }
  .ring.chosen {
    stroke-dasharray: none;
  }
  .ring.attack {
    stroke: var(--danger);
  }
  .ring.move {
    stroke: var(--ok);
  }
  .flash {
    fill: none;
    stroke: var(--map-flash);
    stroke-width: 5;
    opacity: 0;
    transition: opacity 300ms ease-out;
    pointer-events: none;
  }
  .flash.on {
    opacity: 0.95;
  }
  @media (prefers-reduced-motion: reduce) {
    .flash {
      transition: none;
    }
  }
  /* System serif fonts only; the parchment halo keeps names legible on every owner color. */
  .label,
  .continent {
    fill: var(--map-ink);
    stroke: var(--map-label-halo);
    stroke-width: 3.5px;
    stroke-linejoin: round;
    paint-order: stroke;
    font-family: "Iowan Old Style", "Palatino", "Palatino Linotype", Georgia, serif;
    font-size: 13px;
  }
  .continent {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.14em;
  }
  .badge {
    fill: var(--map-counter-field);
    stroke: var(--map-ink);
    stroke-width: 1px;
  }
  .badge-text {
    fill: var(--map-counter-ink);
    font-size: 10px;
    font-weight: 700;
  }
  .leader {
    stroke: var(--map-ink);
    stroke-width: 1px;
  }
  .hint {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    max-width: calc(100% - 1rem);
    padding: 0.35rem 0.7rem;
    border-radius: 8px;
    background: var(--map-hint-bg);
    color: var(--text);
    font-size: 0.95rem;
    pointer-events: none;
  }
  .hint.empty {
    opacity: 0;
  }
</style>
