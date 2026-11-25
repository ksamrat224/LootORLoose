import { test, expect } from "@playwright/test";

for (const width of [375, 768, 1280]) {
  test(`stake entry, public odds and full refund at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Keep the haul/ })
    ).toBeVisible();
    await expect(
      page.getByText("95% theoretical return", { exact: false })
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /Devnet wager/ })
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Choose stake · enter dungeon" })
      .click();
    const input = page.getByLabel("Stake in demo credits");
    await input.fill("2.001");
    await page.getByRole("button", { name: "Start practice run" }).click();
    await expect(page.locator("#stake-error")).toContainText("at most two");
    await page.getByRole("button", { name: "$5.00 demo", exact: true }).click();
    await page.getByRole("button", { name: "Start practice run" }).click();
    await expect(page.getByText("$95.00", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Risk gate 1", exact: true })
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Cancel · return full stake" })
      .click();
    await expect(
      page.getByText("Stake refund frozen", { exact: false })
    ).toBeVisible();
    await page.getByRole("button", { name: "Settle practice result" }).click();
    await expect(page.getByText("REFUNDED", { exact: true })).toBeVisible();
    await expect(
      page.locator(".result-summary").getByText("$100.00", { exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBeTruthy();
  });
}

test("gate success and failure fixtures exercise the real UI without rerolls", async ({
  page,
}) => {
  // Only browser practice randomness is controlled. This does not mock or claim live VRF.
  await page.addInitScript(() => {
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(
      value: T
    ): T => {
      if (value instanceof Uint32Array) value.fill(0);
      return value;
    }) as typeof crypto.getRandomValues;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose stake · enter dungeon" })
    .click();
  await page.getByRole("button", { name: "Start practice run" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  for (const key of ["ArrowRight", "ArrowRight", "ArrowDown"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(125);
    await page.keyboard.up(key);
    await page.waitForTimeout(125);
  }
  const risk = page.getByRole("button", { name: "Risk gate 1", exact: true });
  await expect(risk).toBeEnabled();
  await risk.click();
  await expect(
    page.getByText("Practice roll in progress…", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Extract $2.50", exact: true })
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Extract $2.50", exact: true })
    .click();
  await page.getByRole("button", { name: "Settle practice result" }).click();
  await expect(page.getByText("EXTRACTED", { exact: true })).toBeVisible();
  await expect(
    page.locator(".result-summary").getByText("$100.50", { exact: true })
  ).toBeVisible();
});

test("a failed practice gate settles zero without crediting the stake", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.addInitScript(() => {
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(
      value: T
    ): T => {
      if (value instanceof Uint32Array) value.fill(24);
      return value;
    }) as typeof crypto.getRandomValues;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose stake · enter dungeon" })
    .click();
  await page.getByRole("button", { name: "Start practice run" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  for (const direction of ["right", "right", "down"])
    await page
      .getByRole("button", { name: `Move ${direction}`, exact: true })
      .click();
  await page.getByRole("button", { name: "Risk gate 1", exact: true }).click();
  await expect(page.getByText("Gate failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settle practice result" }).click();
  await expect(page.getByText("LOST", { exact: true })).toBeVisible();
  await expect(
    page.locator(".result-summary").getByText("$98.00", { exact: true })
  ).toBeVisible();
});

test("risk away from a gate keeps the run playable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Choose stake · enter dungeon" }).click();
  await page.getByRole("button", { name: "Start practice run" }).click();
  await page.getByRole("button", { name: "Risk gate", exact: true }).click();
  await expect(page.getByText("Your run is still active.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover existing run" })).toHaveCount(0);
  await page.getByRole("button", { name: "Move right", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel · return full stake" })).toBeEnabled();
});
