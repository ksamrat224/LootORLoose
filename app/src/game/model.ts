export const MAP = [
  "################", "#..............#", "#..............#",
  "#....#....#....#", "#....#....#....#", "#....#....#....#",
  "#..............#", "#..............#", "#..............#",
  "################",
] as const;
export const CHESTS = [{ x: 3, y: 2, gold: 10, trap: 0 }, { x: 8, y: 7, gold: 40, trap: 15 }, { x: 12, y: 8, gold: 100, trap: 35 }] as const;
export const ENEMY = { x: 8, y: 5 } as const;
export const EXIT = { x: 14, y: 8 } as const;
export const EARLY_EXIT = { x: 1, y: 8 } as const;
export type Direction = 0 | 1 | 2 | 3;
export type Point = { x: number; y: number };
export type DemoState = { x: number; y: number; hp: number; opened: number; secondsLeft: number; outcome: "active" | "dead" | "timed_out" | "escaped"; message: string };
export const INITIAL_DEMO: DemoState = { x: 1, y: 1, hp: 100, opened: 0, secondsLeft: 180, outcome: "active", message: "Find a chest, then reach the exit." };
export const isWalkable = (x: number, y: number) => MAP[y]?.[x] === ".";
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const isExit = (point: Point) => distance(point, EXIT) === 0 || distance(point, EARLY_EXIT) === 0;
export const pendingGold = (mask: number) => CHESTS.reduce((total, chest, id) => total + ((mask & (1 << id)) ? chest.gold : 0), 0);
export function move(state: DemoState, direction: Direction): DemoState {
  if (state.outcome !== "active") return state;
  const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][direction];
  const x = state.x + dx, y = state.y + dy;
  if (!isWalkable(x, y)) return { ...state, message: "A wall blocks your path." };
  const hp = Math.max(0, state.hp - (distance({ x, y }, ENEMY) <= 1 ? 25 : 0));
  return { ...state, x, y, hp, outcome: hp === 0 ? "dead" : "active", message: hp === 0 ? "The guardian defeated you. Pending loot was lost." : hp < state.hp ? "The guardian hit you for 25 HP." : "Keep exploring." };
}
export function openNearbyChest(state: DemoState): DemoState {
  if (state.outcome !== "active") return state;
  const id = CHESTS.findIndex((chest, index) => !(state.opened & (1 << index)) && distance(state, chest) <= 1);
  if (id < 0) return { ...state, message: "Move next to an unopened chest." };
  const hp = Math.max(0, state.hp - CHESTS[id].trap);
  return { ...state, opened: state.opened | (1 << id), hp, outcome: hp === 0 ? "dead" : "active", message: hp === 0 ? `Chest trap dealt ${CHESTS[id].trap} HP. You died; pending loot was lost.` : `+${CHESTS[id].gold} fictional gold · ${CHESTS[id].trap} HP trap.` };
}
export function extract(state: DemoState): DemoState {
  if (state.outcome !== "active" || !isExit(state)) return { ...state, message: "Stand on either exit tile to extract." };
  return { ...state, outcome: "escaped", message: "Local demo escape. No onchain receipt was created." };
}
