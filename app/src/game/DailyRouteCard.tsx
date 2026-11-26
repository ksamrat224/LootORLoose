import { QUESTS } from "./hunt-rules";
import type { useDailyRoute } from "./useDailyRoute";
export type DailyRouteView = ReturnType<typeof useDailyRoute>;
export function DailyRouteCard({
  route,
  mask = 0,
}: {
  route: DailyRouteView;
  mask?: number;
}) {
  return (
    <section className="q-daily-route" aria-label="Daily Route">
      <h3>
        Daily Route <span className="q-small">{route.day} UTC</span>
      </h3>
      <p>
        Open these three guardians in any order, then collect. Optional; every
        guardian still shares the same reward pool.
      </p>
      {route.current && route.ids.filter((id) => mask & (1 << id)).length < countOpened(mask) && (
        <p className="q-small">Route missed · hunt freely. You can still collect your loot.</p>
      )}
      <ul>
        {route.ids.map((id) => (
          <li key={id}>
            {QUESTS[id].name}
            {mask & (1 << id) ? " · Opened" : ""}
          </li>
        ))}
      </ul>
      <p className="q-small">
        {route.current
          ? `${route.current.steps} steps · ${
              route.current.ranked
                ? "Personal best eligible"
                : "Unranked after recovery"
            }`
          : "Start a new hunt to track this route."}
      </p>
      {route.current?.awarded && (
        <p>Daily stamp earned · {route.current.day}</p>
      )}
      <p className="q-small">
        {Object.keys(route.stamps).length} daily stamps ·{" "}
        {route.stamps[route.day]?.best != null
          ? `Best today: ${route.stamps[route.day].best} steps`
          : "No ranked best for this date"}
      </p>
      <p className="q-small">
        Local to this browser. Steps start at your starting tile; this is not an
        onchain score or a competition. Reloading keeps route eligibility but
        makes the step result unranked.
      </p>
      {!route.persistent && (
        <p role="status">
          Route storage is unavailable. Progress lasts only while this page
          stays open.
        </p>
      )}
    </section>
  );
}

function countOpened(mask: number) {
  return Array.from({ length: 6 }, (_, id) => Number(!!(mask & (1 << id)))).reduce((a, b) => a + b, 0);
}
