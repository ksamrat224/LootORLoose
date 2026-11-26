import { openDashboardPanel, expectDashboardFocus } from "./dashboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import {
  confirmedMask,
  discoveryScope,
  parseProgress,
  revealTiles,
  routeBadges,
} from "../src/game/hunt-discovery";
import { QUESTS, approachPath } from "../src/game/hunt-rules";

const scope = "loot-discovery:v1:practice";
const moves = ["Move up", "Move right", "Move down", "Move left"];
async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
}
async function journal(page: Page) {
  await openDashboardPanel(page, "Journal");
  return page.getByRole("dialog", { name: "Discovery journal" });
}
async function begin(page: Page) {
  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
}
async function savedMap(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(`${key}:map`) || "null"),
    scope,
  );
}

test("all three-quest routes award only their cosmetic badges; discovery is bounded and monotonic", () => {
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++)
      for (let c = b + 1; c < 6; c++) {
        const ids = [a, b, c],
          mask = confirmedMask(ids.map((questId) => ({ questId })));
        const expected =
          mask === 25 ? ["north"] : mask === 38 ? ["south"] : ["across"];
        expect(routeBadges(mask)).toEqual(expected);
        expect(confirmedMask([...ids, a].map((questId) => ({ questId })))).toBe(
          mask,
        );
      }
  expect(confirmedMask([{ questId: 8 }, { questId: -1 }])).toBe(0);
  expect(routeBadges(1)).toEqual([]);
  const tiles = revealTiles([], { x: 1, y: 1 });
  expect(tiles).toContain("1,1");
  expect(tiles).not.toContain("0,1");
  expect(tiles).not.toContain("4,1");
  expect(new Set(revealTiles(tiles, { x: 2, y: 1 })).size).toBeGreaterThan(
    tiles.length,
  );
  expect(parseProgress("broken").unlocked).toBe(0);
  expect(parseProgress('{"version":2,"unlocked":63}').unlocked).toBe(0);
  expect(discoveryScope(true, "a", "devnet", "p")).not.toBe(
    discoveryScope(true, "b", "devnet", "p"),
  );
  expect(discoveryScope(true, "a", "devnet", "p")).not.toBe(
    discoveryScope(false, "a", "devnet", "p"),
  );
  expect(discoveryScope(true, "a", "devnet", "p")).not.toBe(
    discoveryScope(true, "a", "other", "p"),
  );
});

test("guide follows actual actions, dismissal persists and journal can replay it", async ({
  page,
}) => {
  await enter(page);
  await expect(page.getByLabel("Hunt guide")).toContainText("Choose a stake");
  await page.getByRole("button", { name: "Dismiss guide" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Hunt guide")).toHaveCount(0);
  const dialog = await journal(page);
  await dialog.getByRole("button", { name: "Replay guide" }).click();
  await expect(page.getByLabel("Hunt guide")).toBeVisible();
  await begin(page);
  await expect(page.getByLabel("Hunt guide")).toContainText(
    "Walk toward a guardian",
  );
  for (const step of approachPath(QUESTS[0]))
    await page.getByRole("button", { name: moves[step], exact: true }).click();
  await expect(page.getByLabel("Hunt guide")).toContainText("Open this quest");
});

for (const [name, ids] of [
  ["North Trail", [0, 3, 4]],
  ["South Trail", [1, 2, 5]],
  ["Across the Vault", [0, 1, 2]],
] as const)
  test(`${name} unlocks only after collection, including three zero rewards`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.addInitScript(() => {
      const original = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (<T extends ArrayBufferView | null>(
        value: T,
      ): T => {
        if (value instanceof Uint32Array && value.length === 1) {
          value[0] = 0;
          return value;
        }
        if (value)
          original(
            new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
          );
        return value;
      }) as typeof crypto.getRandomValues;
    });
    await enter(page);
    await begin(page);
    let from = { x: 1, y: 1 };
    for (const id of ids) {
      for (const step of approachPath(QUESTS[id], from))
        await page
          .getByRole("button", { name: moves[step], exact: true })
          .click();
      await page
        .getByRole("button", { name: "Open quest", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Open quest", exact: true })
        .click();
      if (id !== ids.at(-1)) {
        await expect(
          page.getByRole("dialog", { name: "Quest revealed" }),
        ).toContainText("No loot found");
        await page.getByRole("button", { name: "Continue hunt" }).click();
      }
      from = QUESTS[id];
    }
    await expect(
      page.getByRole("dialog", { name: "Loot frozen · collect to credit" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).unlocked,
          scope,
        ),
      )
      .toBe(confirmedMask(ids.map((questId) => ({ questId }))));
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).badges,
        scope,
      ),
    ).toEqual([]);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Collect loot", exact: true })
      .click();
    await expect(page.getByLabel("Route badges earned")).toContainText(name);
    await page.getByRole("button", { name: "Return to dungeon" }).click();
    const dialog = await journal(page);
    await expect(dialog).toContainText("3/6");
    await expect(
      dialog
        .locator("article")
        .filter({ has: page.getByRole("heading", { name }) }),
    ).toContainText("Earned");
    await page.keyboard.press("Escape");
    await expectDashboardFocus(page, "Journal");
    await page.reload();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(await journal(page)).toContainText("3/6");
    await expect(
      page.getByRole("dialog").getByText("Earned", { exact: true }),
    ).toHaveCount(1);
  });

test("map discovery survives reload and resets on a new practice hunt", async ({
  page,
}) => {
  await enter(page);
  await begin(page);
  await expect
    .poll(async () => (await savedMap(page))?.tiles.length || 0)
    .toBeGreaterThan(0);
  const first = await savedMap(page);
  for (const step of approachPath(QUESTS[4]))
    await page.getByRole("button", { name: moves[step], exact: true }).click();
  await expect
    .poll(async () => (await savedMap(page))?.tiles.length || 0)
    .toBeGreaterThan(first.tiles.length);
  const explored = await savedMap(page);
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => (await savedMap(page))?.hunt)
    .toBe(explored.hunt);
  await expect
    .poll(async () => (await savedMap(page))?.tiles.length)
    .toBe(explored.tiles.length);
  await page.getByRole("button", { name: "Cancel hunt · full refund" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Collect refund", exact: true })
    .click();
  await page.getByRole("button", { name: "Return to dungeon" }).click();
  await begin(page);
  await expect
    .poll(async () => (await savedMap(page))?.hunt)
    .not.toBe(explored.hunt);
  expect((await savedMap(page)).tiles.length).toBeLessThan(
    explored.tiles.length,
  );
});

test("unavailable local storage leaves practice playable and the journal usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage)
        throw new DOMException("blocked", "SecurityError");
      return original.call(this, key, value);
    };
  });
  await enter(page);
  await begin(page);
  const dialog = await journal(page);
  await expect(dialog).toContainText("Browser storage is unavailable");
  await expect(dialog).toContainText("Route storage is unavailable");
  await expect(
    dialog.getByRole("button", { name: "Replay guide" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Cancel hunt · full refund" }),
  ).toBeEnabled();
});

for (const [width, height] of [
  [375, 667],
  [768, 900],
  [1280, 720],
  [844, 390],
])
  test(`journal scrolls and restores focus at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await enter(page);
    const dialog = await journal(page);
    await expect(dialog).toContainText("0/6");
    await dialog
      .getByRole("button", { name: "Replay guide" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expectDashboardFocus(page, "Journal");
    await expect(
      page.getByRole("button", { name: "Choose stake", exact: true }),
    ).toBeInViewport();
    for (const [button, title] of [
      ["Quests", "Six quests · any order"],
      ["Reward rules", "Reward rules"],
      ["Details", "Technical details"],
      ["Choose stake", "Stake for the hunt"],
    ]) {
      await openDashboardPanel(page, button);
      const current = page.getByRole("dialog", { name: title, exact: true });
      await expect(current).toBeVisible();
      expect(
        await current.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expectDashboardFocus(page, button);
    }
  });
