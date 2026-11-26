import { confirmedMask } from "./hunt-discovery";

export const ROUTES: number[][] = [];
for (let a = 0; a < 6; a++)
  for (let b = a + 1; b < 6; b++)
    for (let c = b + 1; c < 6; c++) ROUTES.push([a, b, c]);
export const utcDay = (time = Date.now()) =>
  new Date(time).toISOString().slice(0, 10);
export function dailyRoute(day: string) {
  const index = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  return ROUTES[((index % 20) + 20) % 20] ?? [];
}
export type RouteRun = {
  hunt: string;
  day: string;
  steps: number;
  ranked: boolean;
  awarded: boolean;
};
export type RouteStore = {
  version: 1;
  current: RouteRun | null;
  stamps: Record<string, { best: number | null }>;
};
export const emptyRoutes = (): RouteStore => ({
  version: 1,
  current: null,
  stamps: {},
});
const validDay = (day: unknown): day is string =>
  typeof day === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day)) &&
  utcDay(Date.parse(day)) === day;
export function parseRoutes(raw: string | null): RouteStore {
  try {
    const value = JSON.parse(raw || "null");
    if (value?.version !== 1) return emptyRoutes();
    const result = emptyRoutes();
    for (const [day, stamp] of Object.entries(value.stamps ?? {})) {
      const best = (stamp as { best?: unknown })?.best;
      if (
        validDay(day) &&
        (best === null || (Number.isSafeInteger(best) && Number(best) >= 0))
      )
        result.stamps[day] = { best: best as number | null };
    }
    const c = value.current;
    if (
      c &&
      typeof c.hunt === "string" &&
      validDay(c.day) &&
      Number.isSafeInteger(c.steps) &&
      c.steps >= 0 &&
      typeof c.ranked === "boolean" &&
      typeof c.awarded === "boolean"
    )
      result.current = { ...c, ranked: false }; // A restored walking history is unranked.
    return result;
  } catch {
    return emptyRoutes();
  }
}
export function awardRoute(
  store: RouteStore,
  reveals: readonly { questId: number }[],
  collected: boolean,
): RouteStore {
  const run = store.current;
  if (
    !run ||
    run.awarded ||
    !collected ||
    reveals.length !== 3 ||
    confirmedMask(reveals) !==
      confirmedMask(dailyRoute(run.day).map((questId) => ({ questId })))
  )
    return store;
  const old = store.stamps[run.day]?.best ?? null;
  const best = run.ranked ? Math.min(old ?? Infinity, run.steps) : old;
  return {
    ...store,
    current: { ...run, awarded: true },
    stamps: { ...store.stamps, [run.day]: { best } },
  };
}
