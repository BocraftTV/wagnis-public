<script lang="ts">
  import { route } from "./lib/route.svelte.js";
  import Room from "./views/Room.svelte";
  import Start from "./views/Start.svelte";
</script>

{#if route.roomId}
  {#key route.roomId}
    <Room roomId={route.roomId} />
  {/key}
{:else}
  <Start />
{/if}
