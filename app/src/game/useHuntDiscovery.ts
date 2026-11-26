"use client";
import { useEffect, useRef, useState } from "react";
import type { Wager } from "@/lib/hunt-chain";
import type { Point } from "./model";
import {
  confirmedMask,
  emptyProgress,
  parseProgress,
  revealTiles,
  routeBadges,
  type DiscoveryProgress,
} from "./hunt-discovery";

type View = {
  scope: string;
  progress: DiscoveryProgress;
  hunt: string;
  tiles: string[];
  persistent: boolean;
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
export function useHuntDiscovery(
  scope: string,
  attempt: Wager | null,
  point: Point,
  ready: boolean,
) {
  const [view, setView] = useState<View>({
    scope: "",
    progress: emptyProgress(),
    hunt: "",
    tiles: [],
    persistent: true,
  });
  const current = useRef(view);
  const practiceId = useRef("");
  useEffect(() => {
    const timer = setTimeout(() => {
      const progress = parseProgress(read(scope));
      const persistent = write(scope, progress);
      current.current = { scope, progress, hunt: "", tiles: [], persistent };
      practiceId.current = read(`${scope}:practice-hunt`) || "";
      setView(current.current);
    }, 0);
    return () => clearTimeout(timer);
  }, [scope]);
  const huntIdentity = attempt
    ? `${attempt.address.toBase58()}:${attempt.index}`
    : "";
  const mask = confirmedMask(attempt?.reveals ?? []);
  const settled = !!attempt?.settled && attempt.phase === "complete";
  useEffect(() => {
    if (!ready || !attempt || current.current.scope !== scope) return;
    const timer = setTimeout(() => {
      if (current.current.scope !== scope) return;
      const old = current.current;
      const practice =
        attempt.address.toBase58() === "11111111111111111111111111111111";
      if (practice && !practiceId.current) {
        practiceId.current = crypto.randomUUID();
        try {
          localStorage.setItem(`${scope}:practice-hunt`, practiceId.current);
        } catch {}
      }
      const hunt = practice ? practiceId.current : huntIdentity;
      let tiles = old.hunt === hunt ? old.tiles : [];
      if (old.hunt !== hunt) {
        try {
          const saved = JSON.parse(read(`${scope}:map`) || "null");
          if (saved?.hunt === hunt && Array.isArray(saved.tiles))
            tiles = saved.tiles.filter(
              (t: unknown) => typeof t === "string" && /^\d+,\d+$/.test(t),
            );
        } catch {}
      }
      tiles = revealTiles(tiles, { x: point.x, y: point.y });
      const earned = settled ? routeBadges(mask) : [];
      const progress = {
        ...old.progress,
        unlocked: old.progress.unlocked | mask,
        badges: [...new Set([...old.progress.badges, ...earned])],
      };
      const persistent =
        write(scope, progress) && write(`${scope}:map`, { hunt, tiles });
      current.current = { scope, progress, hunt, tiles, persistent };
      setView(current.current);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    scope,
    ready,
    huntIdentity,
    mask,
    settled,
    point.x,
    point.y,
    attempt,
    view.scope,
  ]);
  const guide = (dismissed: boolean) => {
    if (current.current.scope !== scope) return;
    const old = current.current;
    const progress = { ...old.progress, guideDismissed: dismissed };
    current.current = { ...old, progress, persistent: write(scope, progress) };
    setView(current.current);
  };
  const startPracticeHunt = () => {
    practiceId.current = crypto.randomUUID();
    try {
      localStorage.setItem(`${scope}:practice-hunt`, practiceId.current);
    } catch {}
  };
  const visible =
    view.scope === scope
      ? view
      : { progress: emptyProgress(), tiles: [], persistent: true };
  return { ...visible, loaded: view.scope === scope, guide, startPracticeHunt };
}
