"use client";
import { useEffect, useRef, useState } from "react";
import type { Wager } from "@/lib/hunt-chain";
import {
  awardRoute,
  dailyRoute,
  emptyRoutes,
  parseRoutes,
  utcDay,
  type RouteStore,
} from "./daily-route";

export function useDailyRoute(
  scope: string,
  hunt: string,
  attempt: Wager | null,
  ready: boolean,
  now: number,
) {
  const key = `loot-daily-route:v1:${scope}`;
  const ref = useRef({ key: "", store: emptyRoutes(), persistent: true });
  const [view, setView] = useState({
    key: "",
    store: emptyRoutes(),
    persistent: true,
  });
  const [initialDay] = useState(() => utcDay());
  const save = (store: RouteStore) => {
    let persistent = true;
    try {
      localStorage.setItem(key, JSON.stringify(store));
    } catch {
      persistent = false;
    }
    ref.current = { key, store, persistent };
    setView(ref.current);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      let store = emptyRoutes(),
        persistent = true;
      try {
        store = parseRoutes(localStorage.getItem(key));
      } catch {
        persistent = false;
      }
      ref.current = { key, store, persistent };
      setView(ref.current);
    }, 0);
    return () => clearTimeout(timer);
  }, [key]);
  useEffect(() => {
    if (
      !ready ||
      !attempt ||
      ref.current.key !== key ||
      ref.current.store.current?.hunt !== hunt
    )
      return;
    const timer = setTimeout(() => {
      if (ref.current.key !== key || ref.current.store.current?.hunt !== hunt)
        return;
      const old = ref.current.store;
      const next = awardRoute(
        old,
        attempt.reveals,
        attempt.settled && attempt.phase === "complete",
      );
      if (next !== old) {
        let persistent = true;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          persistent = false;
        }
        ref.current = { key, store: next, persistent };
        setView(ref.current);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [key, hunt, attempt, ready, view.key]);
  const store = view.key === key ? view.store : emptyRoutes();
  const current =
    ready && attempt && store.current?.hunt === hunt ? store.current : null;
  const day = current?.day ?? (now ? utcDay(now * 1000) : initialDay);
  return {
    current,
    day,
    ids: dailyRoute(day),
    stamps: store.stamps,
    persistent: view.key !== key || view.persistent,
    start: (id: string, date: string) =>
      save({
        ...(ref.current.key === key ? ref.current.store : emptyRoutes()),
        current: {
          hunt: id,
          day: date,
          steps: 0,
          ranked: true,
          awarded: false,
        },
      }),
    move: () => {
      if (
        !ready ||
        !attempt ||
        attempt.revealCount >= 3 ||
        ref.current.key !== key
      )
        return;
      const old = ref.current.store;
      if (old.current?.hunt === hunt)
        save({
          ...old,
          current: { ...old.current, steps: old.current.steps + 1 },
        });
    },
  };
}
