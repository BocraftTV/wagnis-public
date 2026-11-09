// How the map marks a territory: a ring when it can be picked or is chosen, in the tone of the current action.
export interface TerritoryMark {
  pickable: boolean;
  ring: "none" | "pick" | "chosen";
  tone: "place" | "attack" | "move";
}
