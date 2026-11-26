import { isWalkable, type Direction, type Point } from "./model";
import { QUESTS as OLD_QUESTS } from "./quest-rules";
export { STEP_DELTAS } from "./quest-rules";
import { STEP_DELTAS } from "./quest-rules";
export const UNCHOSEN_QUEST = 255;
export const QUESTS = OLD_QUESTS.map(({ id, name, x, y }) => ({
  id,
  name,
  x,
  y,
  description: [
    "A watchman's chamber behind copper doors.",
    "The silver guard waits in the southern hall.",
    "An emerald glow spills from the guardian's chamber.",
    "A quiet keep carved from dark stone.",
    "Explore the crown's chamber in the northeast.",
    "Seek the dragon's chamber in the southeast.",
  ][id],
}));
const V5_REWARDS = [
  { limit: 40, n: 0, d: 1, label: "0×", chance: "40%" },
  { limit: 70, n: 1, d: 4, label: "0.25×", chance: "30%" },
  { limit: 90, n: 1, d: 2, label: "0.5×", chance: "20%" },
  { limit: 98, n: 1, d: 1, label: "1×", chance: "8%" },
  { limit: 100, n: 5, d: 3, label: "5/3×", chance: "2%" },
] as const;
export const PRACTICE_RULES_VERSION = 6;
const V6_REWARDS = [
  { limit: 10, n: 0, d: 1, label: "0×", chance: "10%" },
  { limit: 40, n: 1, d: 4, label: "0.25×", chance: "30%" },
  { limit: 99, n: 2, d: 5, label: "0.4×", chance: "59%" },
  { limit: 100, n: 3, d: 4, label: "0.75×", chance: "1%" },
] as const;
export function supportedHuntRules(version: number): version is 5 | 6 {
  return version === 5 || version === 6;
}
export function rewardRules(version: number) {
  if (!supportedHuntRules(version)) throw new Error("Unsupported hunt rules");
  return version === 5
    ? { rewards: V5_REWARDS, averageReturn: "86.5%" }
    : { rewards: V6_REWARDS, averageReturn: "95.55%" };
}
export function huntReward(stake: number, bucket: number, version: number) {
  if (
    !Number.isSafeInteger(stake) ||
    stake < 100 ||
    stake > 10000 ||
    !Number.isInteger(bucket) ||
    bucket < 0 ||
    bucket > 99
  )
    throw new Error("Invalid stake or reward bucket");
  const rule = rewardRules(version).rewards.find((r) => bucket < r.limit)!;
  return Math.floor((stake * rule.n) / rule.d);
}
export const huntReserve = (stake: number, version: number) =>
  3 * huntReward(stake, 99, version);
export function practiceBucket() {
  const limit = 0x100000000 - (0x100000000 % 100),
    bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return bytes[0] % 100;
}
/** Shortest legal approach from the last confirmed position. No teleportation. */
export function approachPath(
  target: Point,
  start: Point = { x: 1, y: 1 },
): Direction[] {
  const queue: { point: Point; path: Direction[] }[] = [
    { point: start, path: [] },
  ];
  const seen = new Set([`${start.x},${start.y}`]);
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
