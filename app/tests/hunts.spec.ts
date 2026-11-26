import { openDashboardPanel, expectDashboardFocus } from "./dashboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import {
  QUESTS,
  approachPath,
  huntReward,
  huntReserve,
} from "../src/game/hunt-rules";
import { verifyHunt } from "../src/game/HuntProof";
const moves = ["Move up", "Move right", "Move down", "Move left"];
async function start(page: Page, buckets: number[] = [40, 0, 99]) {
  await page.addInitScript((buckets) => {
    let index = 0;
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(
      value: T,
    ): T => {
      if (value instanceof Uint32Array && value.length === 1) {
        value[0] = buckets[index++ % buckets.length];
        return value;
      }
      if (value)
        original(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        );
      return value;
    }) as typeof crypto.getRandomValues;
  }, buckets);
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
}
async function open(page: Page, id: number, from = { x: 1, y: 1 }) {
  for (const step of approachPath(QUESTS[id], from))
    await page.getByRole("button", { name: moves[step], exact: true }).click();
  await page.getByRole("button", { name: "Open quest", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: `Open · ${QUESTS[id].name}`,
  });
  await expect(dialog).not.toContainText(/%|[0-9]\s*×|chance|probability/i);
  await dialog.getByRole("button", { name: "Open quest", exact: true }).click();
}
for (const first of QUESTS)
  test(`stake once and hunt three with ${first.name} first`, async ({
    page,
  }) => {
    // Three full walking paths plus dialogs can exceed 30s on busy CI hosts.
    test.setTimeout(60000);
    await start(page);
    await expect(page.getByLabel("Demo amounts")).toContainText("$98.00");
    await expect(page.getByLabel("Demo amounts")).toContainText("Unrevealed");
    const choices = [first.id, (first.id + 1) % 6, (first.id + 2) % 6];
    let from = { x: 1, y: 1 };
    for (let i = 0; i < 3; i++) {
      await open(page, choices[i], from);
      from = QUESTS[choices[i]];
      if (i < 2) {
        const reveal = page.getByRole("dialog", { name: "Quest revealed" });
        await expect(reveal).toBeVisible();
        if (i === 1) await expect(reveal).toContainText("No loot found");
        await reveal.getByRole("button", { name: "Continue hunt" }).click();
        await expect(page.getByLabel("Demo amounts")).toContainText("$0.80");
        await expect(
          page.getByRole("button", { name: "Cancel hunt · full refund" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Collect loot", exact: true }),
        ).toHaveCount(0);
        await openDashboardPanel(page, "Quests");
        await expect(
          page.getByRole("button", {
            name: new RegExp(`${choices[i] + 1} · ${QUESTS[choices[i]].name}`),
          }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
      }
    }
    const result = page.getByRole("dialog", {
      name: "Loot frozen · collect to credit",
    });
    await expect(result).toBeVisible();
    await expect(result.locator(".q-result-amounts")).toContainText("$2.30");
    await result
      .getByRole("button", { name: "Collect loot", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "LOOT COLLECTED" }),
    ).toContainText("$100.30");
    await page.getByRole("button", { name: "Return to dungeon" }).click();
    await expect(
      page.getByRole("button", { name: "Choose stake", exact: true }),
    ).toBeVisible();
  });
test("three zero rewards still finish the hunt; cancellation refunds only before opening", async ({
  page,
}) => {
  await start(page, [0]);
  await page.getByRole("button", { name: "Cancel hunt · full refund" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Collect refund", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "REFUNDED" })).toContainText(
    "$100.00",
  );
  await page.getByRole("button", { name: "Return to dungeon" }).click();
  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
  let from = { x: 1, y: 1 };
  for (let id = 0; id < 3; id++) {
    await open(page, id, from);
    from = QUESTS[id];
    if (id < 2) {
      await expect(
        page.getByRole("dialog", { name: "Quest revealed" }),
      ).toContainText("No loot found");
      await page.getByRole("button", { name: "Continue hunt" }).click();
    }
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Collect loot", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "LOOT COLLECTED" }),
  ).toContainText("$98.00");
});
for (const [width, height] of [
  [375, 667],
  [768, 900],
  [1280, 720],
  [844, 390],
])
  test(`hunt viewport and reward rules at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const overflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      );
    expect(await overflow()).toBe(false);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "Devnet", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(
        async () => (await page.locator("canvas").boundingBox())?.width ?? 0,
      )
      .toBeGreaterThan(width === 375 ? 300 : 200);
    expect(await overflow()).toBe(false);
    await openDashboardPanel(page, "Reward rules");
    await expect(
      page.getByRole("dialog", { name: "Reward rules" }),
    ).toContainText("All six quests");
    expect(await overflow()).toBe(false);
    await page.keyboard.press("Escape");
    await expectDashboardFocus(page, "Reward rules");
  });
test("reward boundaries, rounding and complete proof totals", async () => {
  for (const [b, value] of [
    [0, 0],
    [39, 0],
    [40, 25],
    [69, 25],
    [70, 50],
    [89, 50],
    [90, 101],
    [97, 101],
    [98, 168],
    [99, 168],
  ])
    expect(huntReward(101, b, 5)).toBe(value);
  expect(huntReserve(101, 5)).toBe(504);
  expect(() => huntReward(100, 100, 5)).toThrow();
  const reveals = [0, 40, 99].map((bucket, questId) => ({
    questId,
    bucket,
    reward: huntReward(200, bucket, 5),
    randomness: [bucket, ...Array(31).fill(0)],
  }));
  const hunt = {
    rulesVersion: 5,
    stake: 200,
    revealCount: 3,
    openedMask: 7,
    reveals,
    payout: 383,
    phase: "complete" as const,
  };
  expect(await verifyHunt(hunt)).toBe(true);
  expect(await verifyHunt({ ...hunt, payout: 384 })).toBe(false);
  expect(
    await verifyHunt({
      ...hunt,
      reveals: [reveals[0], reveals[0], reveals[2]],
    }),
  ).toBe(false);
});
test("practice reload retains loot and completes the same pending draw", async ({
  page,
}) => {
  await start(page, [40, 99, 0]);
  await open(page, 0);
  await expect(
    page.getByRole("dialog", { name: "Quest revealed" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Demo amounts")).toContainText("$0.80");
  await expect(page.getByLabel("Demo amounts")).toContainText("1/3");
  for (const step of approachPath(QUESTS[1], QUESTS[0]))
    await page.getByRole("button", { name: moves[step], exact: true }).click();
  await page.getByRole("button", { name: "Open quest", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Open · Silver Sentinel" })
    .getByRole("button", { name: "Open quest", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Demo amounts")).toContainText("2/3");
  await expect(page.getByLabel("Demo amounts")).toContainText("$2.30");
  await expect(
    page.getByRole("button", { name: "Cancel hunt · full refund" }),
  ).toHaveCount(0);
});
test("phone hunt keeps both actions and all four amounts fully inside their panels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await start(page);
  expect(
    await page
      .locator(".q-actions")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
  const amounts = await page
    .locator(".q-amounts > span")
    .evaluateAll((elements) =>
      elements.map((el) => ({
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
        childRight: el.querySelector("strong")!.getBoundingClientRect().right,
      })),
    );
  for (let i = 0; i < amounts.length; i++) {
    expect(amounts[i].childRight).toBeLessThanOrEqual(amounts[i].right + 1);
    if (i && amounts[i].top === amounts[i - 1].top)
      expect(amounts[i].left).toBeGreaterThan(amounts[i - 1].right);
    else if (i) expect(amounts[i].top).toBeGreaterThan(amounts[i - 1].bottom);
  }
  await expect(
    page.getByRole("button", { name: "Cancel hunt · full refund" }),
  ).toBeVisible();
});
