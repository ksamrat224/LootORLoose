import { test, expect } from "@playwright/test";
import { openDashboardPanel, expectDashboardFocus } from "./dashboard-helpers";

for (const [width, height] of [
  [375, 667],
  [768, 900],
  [1280, 720],
  [844, 390],
  [1920, 1080],
])
  test(`dashboard cards, controls and menu remain readable at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const game = page.getByRole("region", { name: "Six quest dungeon" });
    const cards = game.locator(".q-amounts > span");
    await expect(cards).toHaveCount(4);
    await expect(page.getByLabel("Demo amounts")).toContainText("Unrevealed");
    await expect(
      page.locator('.hunt-progress-pips > i[data-complete="true"]'),
    ).toHaveCount(0);
    await expect(game.locator(".hunt-header-demo")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Interact", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Move up", exact: true }),
    ).toBeInViewport();
    expect(await game.evaluate((e) => e.clientWidth)).toBeLessThanOrEqual(1600);
    for (const card of await cards.all()) {
      expect(
        await card.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const [bg, panel] = await card.evaluate((el) => [
        getComputedStyle(el).backgroundImage,
        getComputedStyle(el).borderRadius,
      ]);
      expect(bg).not.toBe("none");
      expect(parseFloat(panel)).toBeGreaterThanOrEqual(10);
    }
    const controls = await page.getByLabel("Touch game controls").boundingBox();
    const board = await page.locator(".game-canvas").boundingBox();
    expect(controls!.y).toBeGreaterThanOrEqual(board!.y + board!.height - 1);
    const move = await page
      .getByRole("button", { name: "Move up", exact: true })
      .boundingBox();
    expect(move!.height).toBeGreaterThanOrEqual(44);
    await openDashboardPanel(page, "Journal");
    await expect(
      page.getByRole("dialog", { name: "Discovery journal" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expectDashboardFocus(page, "Journal");
    await page
      .getByRole("button", { name: "Choose stake", exact: true })
      .click();
    await expect(page.getByLabel("Stake in demo credits")).toHaveValue("2.00");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "$10.00", exact: true })
      .click();
    await expect(page.getByLabel("Stake in demo credits")).toHaveValue("10.00");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Demo amounts")).toContainText("$100.00");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  });

test("desktop shortcuts only prefill the explicit start dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByLabel("Quick stake amounts")
    .getByRole("button", { name: "$5", exact: true })
    .click();
  await expect(page.getByLabel("Stake in demo credits")).toHaveValue("5.00");
  expect(
    await page.evaluate(() => sessionStorage.getItem("loot-hunt-v5-practice")),
  ).toBeNull();
  await expect(page.getByLabel("Demo amounts")).toContainText("$100.00");
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
  await expect(page.getByLabel("Demo amounts")).toContainText("$95.00");
  await expect(page.getByLabel("Quick stake amounts")).toHaveCount(0);
});

for (const pending of [false, true])
  test(`progress pips count confirmed reveals only, pending=${pending}`, async ({
    page,
  }) => {
    if (pending) await page.setViewportSize({ width: 375, height: 667 });
    await page.addInitScript((pending) => {
      if (pending) {
        const original = setTimeout;
        window.setTimeout = ((
          fn: TimerHandler,
          ms?: number,
          ...args: unknown[]
        ) =>
          original(fn, ms === 900 ? 60000 : ms, ...args)) as typeof setTimeout;
      }
      sessionStorage.setItem(
        "loot-hunt-v5-practice",
        JSON.stringify({
          balance: 9800,
          point: { x: 4, y: 1 },
          attempt: {
            rulesVersion: 6,
            index: 0,
            stake: 200,
            questId: pending ? 1 : 255,
            phase: pending ? "randomnessPending" : "active",
            x: 4,
            y: 1,
            nonce: pending ? 3 : 2,
            requestNonce: pending ? 2 : 1,
            requestedAt: Math.floor(Date.now() / 1000),
            payout: 80,
            delegated: false,
            settled: false,
            openedMask: 1,
            revealCount: 1,
            reveals: [{ questId: 0, bucket: 40, randomness: [], reward: 80 }],
            practiceBuckets: [40, 0, 99],
          },
        }),
      );
    }, pending);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.locator('.hunt-progress-pips > i[data-complete="true"]'),
    ).toHaveCount(1);
    await expect(page.getByLabel("Demo amounts")).toContainText("1/3");
    await expect(page.getByLabel("Demo amounts")).toContainText("$0.80");
    if (pending) {
      await expect(
        page.getByRole("heading", { name: "Revealing quest", exact: true }),
      ).toBeVisible();
      await expect
        .poll(
          async () => (await page.locator("canvas").boundingBox())?.width || 0,
        )
        .toBeGreaterThanOrEqual(300);
    }
  });

test("dashboard text, gold actions and focus colors meet contrast requirements", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const ratios = await page.locator(".hunt-game").evaluate((el) => {
    const styles = getComputedStyle(el),
      canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((v) => {
          const n = v / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
    };
    const luminance = (color: string) =>
      rgb(color).reduce(
        (sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i],
        0,
      );
    const contrast = (a: string, b: string) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const token = (key: string) => styles.getPropertyValue(key).trim();
    return {
      body: contrast(token("--foreground"), "oklch(0.24 0.03 65)"),
      muted: contrast(token("--muted"), "oklch(0.24 0.03 65)"),
      action: contrast(token("--primary-fg"), "oklch(0.72 0.15 65)"),
      focus: contrast(token("--primary"), token("--surface")),
    };
  });
  expect(ratios.body).toBeGreaterThanOrEqual(4.5);
  expect(ratios.muted).toBeGreaterThanOrEqual(4.5);
  expect(ratios.action).toBeGreaterThanOrEqual(4.5);
  expect(ratios.focus).toBeGreaterThanOrEqual(3);
});
