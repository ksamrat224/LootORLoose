import { test, expect, type Page } from "@playwright/test";
import {
  ROUTES,
  dailyRoute,
  utcDay,
  emptyRoutes,
  awardRoute,
  parseRoutes,
} from "../src/game/daily-route";
import { discoveryScope } from "../src/game/hunt-discovery";
import { QUESTS, approachPath } from "../src/game/hunt-rules";
import { openDashboardPanel } from "./dashboard-helpers";
const key = "loot-daily-route:v1:loot-discovery:v1:practice";
const date = "2026-11-26";
const moves = ["Move up", "Move right", "Move down", "Move left"];
const read = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), key);

test("all 20 daily targets, exact confirmed collection, UTC boundaries and idempotent records", () => {
  expect(ROUTES).toHaveLength(20);
  const seen = new Set<string>();
  for (let d = 0; d < 20; d++) {
    const day = utcDay(Date.UTC(2026, 10, 1 + d));
    const ids = dailyRoute(day);
    seen.add(ids.join());
    expect(new Set(ids).size).toBe(3);
    for (const order of [ids, [...ids].reverse(), [ids[1], ids[2], ids[0]]]) {
      const state = {
        ...emptyRoutes(),
        current: { hunt: "test", day, steps: 22, ranked: true, awarded: false },
      };
      const reveals = order.map((questId) => ({ questId, reward: 0 }));
      expect(awardRoute(state, reveals, false)).toBe(state);
      expect(awardRoute(state, reveals.slice(0, 2), true)).toBe(state);
      const result = awardRoute(state, reveals, true);
      expect(result.stamps[day].best).toBe(22);
      expect(awardRoute(result, reveals, true)).toBe(result);
      const recovered = parseRoutes(JSON.stringify(state));
      expect(recovered.current?.ranked).toBe(false);
      expect(awardRoute(recovered, reveals, true).stamps[day].best).toBeNull();
      const wrong = [
        ...reveals.slice(0, 2),
        { questId: ids.find((id) => id === order[0])!, reward: 0 },
      ];
      expect(awardRoute(state, wrong, true)).toBe(state);
    }
  }
  expect(seen.size).toBe(20);
  expect(utcDay(Date.parse("2026-11-26T23:59:59Z"))).toBe(date);
  expect(utcDay(Date.parse("2026-11-27T00:00:00Z"))).toBe("2026-11-27");
  expect(parseRoutes("broken")).toEqual(emptyRoutes());
  expect(parseRoutes('{"version":2}')).toEqual(emptyRoutes());
  expect(
    new Set([
      discoveryScope(false, "a", "devnet", "p"),
      discoveryScope(true, "a", "devnet", "p"),
      discoveryScope(true, "b", "devnet", "p"),
      discoveryScope(true, "a", "other", "p"),
      discoveryScope(true, "a", "devnet", "q"),
    ]).size,
  ).toBe(5);
});

for (const reload of [false, true])
  test(`daily route zero loot, rollover and collection${
    reload ? " after reload" : " with step best"
  }`, async ({ page }) => {
    test.setTimeout(60000);
    await page.clock.setFixedTime(new Date(`${date}T23:59:50Z`));
    await page.addInitScript(() => {
      const original = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = ((value: Uint32Array) => {
        if (value instanceof Uint32Array && value.length === 1) {
          value[0] = 0;
          return value;
        }
        return original(value);
      }) as typeof crypto.getRandomValues;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const tracker = page.getByLabel("Daily route progress").first();
    await expect(tracker).toHaveText("0/3");
    await expect(page.locator(".hunt-route-ribbon")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Choose stake", exact: true })
      .click();
    const ids = [...dailyRoute(date)].reverse();
    for (const id of ids)
      await expect(page.getByLabel("Today’s route")).toContainText(
        QUESTS[id].name,
      );
    await page.getByRole("button", { name: "Start hunt", exact: true }).click();
    await expect.poll(async () => (await read(page))?.current?.day).toBe(date);
    await page.getByRole("button", { name: "Move up", exact: true }).click(); // blocked wall
    expect((await read(page)).current.steps).toBe(0);
    await page.clock.setFixedTime(new Date("2026-11-27T00:00:10Z"));
    let from = { x: 1, y: 1 },
      steps = 0;
    for (let i = 0; i < 3; i++) {
      const path = approachPath(QUESTS[ids[i]], from);
      for (const step of path)
        await page
          .getByRole("button", { name: moves[step], exact: true })
          .click();
      steps += path.length;
      await page
        .getByRole("button", { name: "Open quest", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Open quest", exact: true })
        .click();
      if (i < 2) {
        await page.getByRole("button", { name: "Continue hunt" }).click();
        await expect(tracker).toHaveText(`${i + 1}/3`);
        if (reload && i === 0) {
          await page.reload();
          await page.getByRole("button", { name: "Play", exact: true }).click();
          await openDashboardPanel(page, "Journal");
          await expect(page.getByRole("dialog")).toContainText(
            "Unranked after recovery",
          );
          await expect(page.getByRole("dialog")).toContainText(date);
          await page.keyboard.press("Escape");
        }
      }
      from = QUESTS[ids[i]];
    }
    await expect(
      page.getByRole("dialog", { name: "Loot frozen · collect to credit" }),
    ).toBeVisible();
    expect((await read(page)).stamps).toEqual({});
    expect((await read(page)).current.steps).toBe(steps);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Collect loot", exact: true })
      .click();
    await expect(page.getByLabel("Daily stamp earned")).toContainText(date);
    await expect(tracker).toHaveText("✓");
    await expect(page.getByRole("dialog")).toContainText("$98.00");
    expect((await read(page)).stamps[date].best).toBe(reload ? null : steps);
    await page.reload();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await openDashboardPanel(page, "Journal");
    await expect(page.getByRole("dialog")).toContainText("1 daily stamps");
    expect((await read(page)).stamps[date].best).toBe(reload ? null : steps);
  });

test("an off-route reveal visibly ends the optional route", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
  const offRoute = QUESTS.find(
    (quest) => !dailyRoute(date).includes(quest.id),
  )!;
  for (const step of approachPath(offRoute))
    await page.getByRole("button", { name: moves[step], exact: true }).click();
  await page.getByRole("button", { name: "Open quest", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open quest", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue hunt" }).click();
  const tracker = page.getByLabel("Daily route progress").first();
  await expect(tracker).toHaveText("0/3");
  await openDashboardPanel(page, "Journal");
  await expect(page.getByRole("dialog")).toContainText("Route missed · hunt freely");
});
