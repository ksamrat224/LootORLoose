import { MAP, isWalkable, type Point } from "./model";

export const GUARDIANS = [
  {
    color: "#E8C389",
    lore: "The watchman kept a lamp burning for travelers who never returned. A copper bell still marks each new arrival.",
  },
  {
    color: "#CBD2D9",
    lore: "The sentinel remembers every footstep in the southern hall. Its silver shield bears the names of forgotten explorers.",
  },
  {
    color: "#83D7C5",
    lore: "Roots have split the chamber's emerald seal. Beneath the stone, something patient listens to the dungeon breathe.",
  },
  {
    color: "#C4B5D5",
    lore: "No banner hangs above the keep. Its guardian tends a small fire for whoever finds a path through the dark.",
  },
  {
    color: "#BAB0ED",
    lore: "The crown rests on an empty throne. Its keeper collects stories of distant places, waiting for one it has never heard.",
  },
  {
    color: "#E39A68",
    lore: "The dragon left no footprints, only warm stone. The chamber's keeper insists that a quiet visitor may still hear its wings.",
  },
] as const;
export const BADGES = [
  {
    id: "north",
    name: "North Trail",
    description:
      "Open Copper Watch, Obsidian Keep and Crown Vault in one hunt.",
    mask: 25,
  },
  {
    id: "south",
    name: "South Trail",
    description:
      "Open Silver Sentinel, Emerald Maw and Dragon Hoard in one hunt.",
    mask: 38,
  },
  {
    id: "across",
    name: "Across the Vault",
    description:
      "Open at least one northern and one southern quest in one hunt.",
    mask: 0,
  },
] as const;
export type BadgeId = (typeof BADGES)[number]["id"];
export type DiscoveryProgress = {
  version: 1;
  unlocked: number;
  badges: BadgeId[];
  guideDismissed: boolean;
};
export const emptyProgress = (): DiscoveryProgress => ({
  version: 1,
  unlocked: 0,
  badges: [],
  guideDismissed: false,
});
export function parseProgress(raw: string | null): DiscoveryProgress {
  try {
    const value = JSON.parse(raw || "null");
    if (value?.version !== 1) return emptyProgress();
    return {
      version: 1,
      unlocked: Number.isInteger(value.unlocked) ? value.unlocked & 63 : 0,
      badges: BADGES.filter(
        (b) => Array.isArray(value.badges) && value.badges.includes(b.id),
      ).map((b) => b.id),
      guideDismissed: value.guideDismissed === true,
    };
  } catch {
    return emptyProgress();
  }
}
export function routeBadges(mask: number): BadgeId[] {
  return BADGES.filter((b) =>
    b.mask ? (mask & b.mask) === b.mask : !!(mask & 25) && !!(mask & 38),
  ).map((b) => b.id);
}
export const tileKey = ({ x, y }: Point) => `${x},${y}`;
export function revealTiles(
  previous: readonly string[],
  point: Point,
): string[] {
  const tiles = new Set(previous);
  MAP.forEach((row, y) =>
    [...row].forEach((_, x) => {
      if (
        isWalkable(x, y) &&
        Math.abs(x - point.x) + Math.abs(y - point.y) <= 2
      )
        tiles.add(`${x},${y}`);
    }),
  );
  return [...tiles];
}
export function discoveryScope(
  live: boolean,
  wallet: string,
  network: string,
  program: string,
) {
  return live
    ? `loot-discovery:v1:devnet:${network}:${program}:${
        wallet || "disconnected"
      }`
    : "loot-discovery:v1:practice";
}
export function confirmedMask(reveals: readonly { questId: number }[]) {
  return reveals.reduce(
    (mask, r) =>
      Number.isInteger(r.questId) && r.questId >= 0 && r.questId < 6
        ? mask | (1 << r.questId)
        : mask,
    0,
  );
}
