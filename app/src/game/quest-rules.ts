import { isWalkable, type Direction, type Point } from "./model";
export const UNCHOSEN_QUEST = 255;
export const QUESTS = [
  {
    id: 0,
    name: "Copper Watch",
    x: 4,
    y: 2,
    numerator: 19,
    denominator: 25,
    returnN: 5,
    returnD: 4,
    multiplier: "1.25×",
    odds: "76%",
    description:
      "The watchman's door. A modest haul with the highest chance of success.",
  },
  {
    id: 1,
    name: "Silver Sentinel",
    x: 3,
    y: 7,
    numerator: 19,
    denominator: 30,
    returnN: 3,
    returnD: 2,
    multiplier: "1.5×",
    odds: "63⅓%",
    description: "Venture south to the silver guard's chamber.",
  },
  {
    id: 2,
    name: "Emerald Maw",
    x: 8,
    y: 7,
    numerator: 19,
    denominator: 40,
    returnN: 2,
    returnD: 1,
    multiplier: "2×",
    odds: "47.5%",
    description:
      "The emerald guardian offers double your stake if you clear its trial.",
  },
  {
    id: 3,
    name: "Obsidian Keep",
    x: 8,
    y: 2,
    numerator: 19,
    denominator: 50,
    returnN: 5,
    returnD: 2,
    multiplier: "2.5×",
    odds: "38%",
    description:
      "Dark stone hides a larger haul and a greater chance of failure.",
  },
  {
    id: 4,
    name: "Crown Vault",
    x: 12,
    y: 2,
    numerator: 19,
    denominator: 60,
    returnN: 3,
    returnD: 1,
    multiplier: "3×",
    odds: "31⅔%",
    description: "The crown's treasure awaits in the northeast chamber.",
  },
  {
    id: 5,
    name: "Dragon Hoard",
    x: 12,
    y: 7,
    numerator: 19,
    denominator: 100,
    returnN: 5,
    returnD: 1,
    multiplier: "5×",
    odds: "19%",
    description:
      "The largest haul and the lowest success chance. The dragon often keeps the stake.",
  },
] as const;
export function questReturn(stake: number, questId: number) {
  const q = QUESTS[questId];
  if (!q || !Number.isSafeInteger(stake) || stake < 100 || stake > 10000)
    throw new Error("Invalid quest or stake");
  return Math.floor((stake * q.returnN) / q.returnD);
}
export const STEP_DELTAS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
/** Shortest legal approach from the program's unchanged spawn. No teleportation. */
export function approachPath(target: Point): Direction[] {
  const queue: { point: Point; path: Direction[] }[] = [
    { point: { x: 1, y: 1 }, path: [] },
  ];
  const seen = new Set(["1,1"]);
  for (let i = 0; i < queue.length; i++) {
    const { point, path } = queue[i];
    if (point.x === target.x && point.y === target.y) return path;
    if (path.length >= 64) continue;
    STEP_DELTAS.forEach(([dx, dy], direction) => {
      const next = { x: point.x + dx, y: point.y + dy };
      const key = `${next.x},${next.y}`;
      if (isWalkable(next.x, next.y) && !seen.has(key)) {
        seen.add(key);
        queue.push({ point: next, path: [...path, direction as Direction] });
      }
    });
  }
  throw new Error("No valid approach to this location");
}
export function practiceSuccess(questId: number) {
  const q = QUESTS[questId];
  if (!q) throw new Error("Unknown quest");
  const d = q.denominator,
    limit = 0x100000000 - (0x100000000 % d),
    bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return bytes[0] % d < q.numerator;
}
