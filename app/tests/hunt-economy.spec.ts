import { test, expect } from "@playwright/test";
import { huntReward, huntReserve, rewardRules } from "../src/game/hunt-rules";
import { QUESTS, approachPath } from "../src/game/hunt-rules";
import { verifyHunt } from "../src/game/HuntProof";
import { newDevnetHuntRules } from "../src/lib/hunt-chain";

test("V6 million three-draw outcomes reproduce the published economy", () => {
  // 6000 cents is divisible by all reward denominators: no rounding in these statistics.
  const rewards = Array.from({ length: 100 }, (_, bucket) =>
    huntReward(6000, bucket, 6),
  );
  let loss = 0,
    even = 0,
    win = 0,
    zero = 0,
    sum = 0;
  for (const a of rewards)
    for (const b of rewards)
      for (const c of rewards) {
        const total = a + b + c;
        sum += total;
        if (total < 6000) loss++;
        else if (total === 6000) even++;
        else win++;
        if (total === 0) zero++;
      }
  expect({ loss, even, win, zero }).toEqual({
    loss: 451930,
    even: 1800,
    win: 546270,
    zero: 1000,
  });
  expect(sum).toBe(6000 * 1_000_000 * 0.9555);
  expect(rewardRules(6).averageReturn).toBe("95.55%");
  expect(rewardRules(5).averageReturn).toBe("86.5%");
});

test("all supported stakes use the exact versioned floors and maximum reservations", () => {
  let mismatch = "";
  // Aggregate assertions keep exhaustive arithmetic checks quick and readable on failure.
  for (const version of [5, 6])
    for (let stake = 100; stake <= 10000; stake++) {
      const max =
        version === 5
          ? Math.floor((stake * 5) / 3)
          : Math.floor((stake * 3) / 4);
      if (huntReserve(stake, version) !== max * 3)
        mismatch = `reserve ${version}/${stake}`;
      for (let bucket = 0; bucket < 100; bucket++) {
        const expected =
          version === 5
            ? bucket < 40
              ? 0
              : bucket < 70
              ? Math.floor(stake / 4)
              : bucket < 90
              ? Math.floor(stake / 2)
              : bucket < 98
              ? stake
              : Math.floor((stake * 5) / 3)
            : bucket < 10
            ? 0
            : bucket < 40
            ? Math.floor(stake / 4)
            : bucket < 99
            ? Math.floor((stake * 2) / 5)
            : Math.floor((stake * 3) / 4);
        if (huntReward(stake, bucket, version) !== expected || expected > max)
          mismatch = `reward ${version}/${stake}/${bucket}`;
      }
    }
  expect(mismatch).toBe("");
  expect(() => huntReward(100, 100, 6)).toThrow();
  expect(() => huntReward(100, 10, 7)).toThrow("Unsupported");
  expect(() => huntReserve(100, 7)).toThrow("Unsupported");
});

test("proofs bind every reward and sum to the stored rules version", async () => {
  for (const version of [5, 6]) {
    const reveals = [10, 40, 99].map((bucket, questId) => ({
      questId,
      bucket,
      randomness: [bucket, ...Array(31).fill(0)],
      reward: huntReward(201, bucket, version),
    }));
    const hunt = {
      rulesVersion: version,
      stake: 201,
      revealCount: 3,
      openedMask: 7,
      reveals,
      payout: reveals.reduce((s, r) => s + r.reward, 0),
      phase: "complete" as const,
    };
    expect(await verifyHunt(hunt)).toBe(true);
    expect(
      await verifyHunt({ ...hunt, rulesVersion: version === 5 ? 6 : 5 }),
    ).toBe(false);
    expect(await verifyHunt({ ...hunt, rulesVersion: 7 })).toBe(false);
    expect(await verifyHunt({ ...hunt, payout: hunt.payout + 1 })).toBe(false);
    expect(
      await verifyHunt({
        ...hunt,
        reveals: [{ ...reveals[0], reward: 999 }, ...reveals.slice(1)],
      }),
    ).toBe(false);
  }
  expect(
    await verifyHunt({
      rulesVersion: 7,
      stake: 200,
      revealCount: 0,
      openedMask: 0,
      reveals: [],
      payout: 200,
      phase: "cancelled",
    }),
  ).toBe(false);
});

test("new devnet hunts remain V5 while V6 creation is gated", () => {
  expect(newDevnetHuntRules()).toBe(5);
});

for (const version of [5, 6])
  test(`reload preserves V${version} pending practice rewards and balance`, async ({
    page,
  }) => {
    await page.addInitScript((version) => {
      const firstReward = version === 5 ? 50 : 80;
      if (!sessionStorage.getItem("fixture-loaded")) {
        sessionStorage.setItem("fixture-loaded", "yes");
        sessionStorage.setItem(
          "loot-hunt-v5-practice",
          JSON.stringify({
            balance: 9800,
            point: { x: 3, y: 7 },
            attempt: {
              rulesVersion: version,
              index: 0,
              stake: 200,
              questId: 1,
              phase: "randomnessPending",
              x: 3,
              y: 7,
              nonce: 3,
              requestNonce: 3,
              requestedAt: 1,
              payout: firstReward,
              delegated: false,
              settled: false,
              openedMask: 1,
              revealCount: 1,
              reveals: [
                { questId: 0, randomness: [], bucket: 40, reward: firstReward },
              ],
              practiceBuckets: [40, 99, 0],
            },
          }),
        );
      }
    }, version);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByLabel("Demo amounts")).toContainText("2/3");
    const loot = version === 5 ? "$3.83" : "$2.30";
    await expect(page.getByLabel("Demo amounts")).toContainText(loot);
    await expect(page.getByLabel("Demo amounts")).toContainText("$98.00");
    await page
      .getByRole("button", { name: "Continue hunt", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reward rules", exact: true })
      .click();
    const rules = page.getByRole("dialog", { name: "Reward rules" });
    await expect(rules).toContainText(`Rules V${version}`);
    await expect(rules).toContainText(version === 5 ? "86.5%" : "95.55%");
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByLabel("Demo amounts")).toContainText(loot);
    await expect(page.getByLabel("Demo amounts")).toContainText("2/3");
    const moves = ["Move up", "Move right", "Move down", "Move left"];
    for (const step of approachPath(QUESTS[2], { x: 3, y: 7 }))
      await page
        .getByRole("button", { name: moves[step], exact: true })
        .click();
    await page.getByRole("button", { name: "Open quest", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Open · Emerald Maw",
    });
    await expect(confirmation).not.toContainText(
      /%|[0-9]\s*×|chance|probability/i,
    );
    await confirmation
      .getByRole("button", { name: "Open quest", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Collect loot", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "LOOT COLLECTED" }),
    ).toContainText(version === 5 ? "$101.83" : "$100.30");
    await page.getByRole("button", { name: "Return to dungeon" }).click();
    await page
      .getByRole("button", { name: "Choose stake", exact: true })
      .click();
    await page.getByRole("button", { name: "Start hunt", exact: true }).click();
    const nextVersion = await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("loot-hunt-v5-practice")!).attempt
          .rulesVersion,
    );
    expect(nextVersion).toBe(6);
  });

test("new practice hunts show V6 rules without changing quest popup copy", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Reward rules", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reward rules" });
  await expect(dialog).toContainText("Rules V6");
  await expect(dialog).toContainText("95.55%");
  await expect(dialog).toContainText("Repeated play can reduce");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Choose stake", exact: true }).click();
  await page.getByRole("button", { name: "Start hunt", exact: true }).click();
  const saved = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("loot-hunt-v5-practice")!).attempt,
  );
  expect(saved.rulesVersion).toBe(6);
});
