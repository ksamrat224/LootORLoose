import { test, expect } from "@playwright/test";
import { QUESTS, approachPath, questReturn } from "../src/game/quest-rules";
import { sampleRandomness } from "../src/game/verify-roll";
const moves = ["Move up", "Move right", "Move down", "Move left"];
for (const q of QUESTS) {
  test(`${q.name} can be hunted after staking at spawn`, async ({ page }) => {
    await page.addInitScript(() => {
      crypto.getRandomValues = (<T extends ArrayBufferView | null>(
        value: T
      ): T => {
        if (value instanceof Uint32Array) value.fill(0);
        return value;
      }) as typeof crypto.getRandomValues;
    });
    await page.goto("/recovery/quests");

    await page
      .getByRole("button", { name: "Choose stake", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Stake for the hunt" })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Prepare practice attempt" })
      .click();
    await expect(page.getByLabel("Demo amounts")).toContainText("$98.00");
    await expect(page.getByLabel("Demo amounts")).toContainText("Unrevealed");
    await expect(page.getByLabel("Demo amounts")).not.toContainText(
      q.multiplier
    );
    await page.getByRole("button", { name: "Quests & odds" }).click();
    await page
      .getByRole("button", { name: new RegExp(`${q.id + 1} · ${q.name}`) })
      .click();
    for (const step of approachPath(q))
      await page
        .getByRole("button", { name: moves[step], exact: true })
        .click();
    await page
      .getByRole("button", { name: "Attempt quest", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: `Attempt · ${q.name}`,
    });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Attempt quest", exact: true })
      .click();
    const result = page.getByRole("dialog", {
      name: "Result frozen · settle to credit",
    });
    await expect(result).toBeVisible();
    await expect(result.locator(".q-result-amounts")).toContainText(
      (questReturn(200, q.id) / 100).toFixed(2)
    );
    await page
      .getByRole("button", { name: "Settle result", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "CLEARED", exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to dungeon", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Choose stake", exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("Demo amounts")).toContainText("Unrevealed");
  });
}
for (const [width, height] of [
  [375, 667],
  [768, 900],
  [1280, 720],
  [844, 390],
]) {
  test(`fixed viewport and accessible drawers at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/recovery/quests");
    const overflow = () =>
      page.evaluate(() => ({
        x: document.documentElement.scrollWidth > innerWidth,
        y: document.documentElement.scrollHeight > innerHeight,
      }));
    expect(await overflow()).toEqual({ x: false, y: false });

    await expect(
      page.getByRole("radio", { name: "Devnet", exact: true })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Interact", exact: true })
    ).toBeVisible();
    expect(await overflow()).toEqual({ x: false, y: false });
    await expect
      .poll(
        async () => (await page.locator("canvas").boundingBox())?.width ?? 0
      )
      .toBeGreaterThan(width === 375 ? 300 : 200);
    await page.getByRole("button", { name: "Quests & odds" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await overflow()).toEqual({ x: false, y: false });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quests & odds" })
    ).toBeFocused();
  });
}
test("failure and cancellation settle the pre-funded stake exactly once", async ({
  page,
}) => {
  await page.addInitScript(() => {
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(
      value: T
    ): T => {
      if (value instanceof Uint32Array) value.fill(24);
      return value;
    }) as typeof crypto.getRandomValues;
  });
  await page.goto("/recovery/quests");

  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Prepare practice attempt" }).click();
  await page
    .getByRole("button", { name: "Cancel · full stake refund" })
    .click();
  await page
    .getByRole("button", { name: "Settle result", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "REFUNDED" })).toContainText(
    "$100.00"
  );
  await page.getByRole("button", { name: "Return to dungeon" }).click();
  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Prepare practice attempt" }).click();
  for (const step of approachPath(QUESTS[0]))
    await page.getByRole("button", { name: moves[step], exact: true }).click();
  await page
    .getByRole("button", { name: "Attempt quest", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Attempt · Copper Watch" })
    .getByRole("button", { name: "Attempt quest", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Settle result", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "LOST", exact: true })
  ).toContainText("$98.00");
});
test("quest odds and proof math agree, including rounding and approach bounds", async () => {
  for (const q of QUESTS) {
    expect(q.numerator * q.returnN * 20).toBe(q.denominator * q.returnD * 19);
    expect(approachPath(q).length).toBeLessThanOrEqual(64);
    const sample = await sampleRandomness(Array(32).fill(0), q.denominator);
    expect(sample.value).toBeLessThan(q.numerator);
  }
  expect(questReturn(101, 0)).toBe(126);
  expect(questReturn(101, 1)).toBe(151);
  expect(() => questReturn(200, 6)).toThrow();
  expect(() => approachPath({ x: 0, y: 0 })).toThrow();
});
