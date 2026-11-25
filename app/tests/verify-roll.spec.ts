import { expect, test } from "@playwright/test";
import { verifyRoll } from "../src/game/verify-roll";

const hex = (value: string) =>
  Array.from(Buffer.from(value, "hex")) as number[];

// Real devnet VRF callbacks recorded in docs/wager-prototype.md (gate 1, 19/25).
test("recomputes the live devnet success roll", async () => {
  const result = await verifyRoll(
    hex("fbbf203d559ec610611d51a5bc56be1a5d5c6f8201ef1be027cdaa2aa7c72156"),
    0
  );
  expect(result).toMatchObject({ sample: 7, success: true, rehashes: 0 });
});

test("recomputes the live devnet failure roll", async () => {
  const result = await verifyRoll(
    hex("12cc756d34165d392a873e04f74c18072136c00809be50f49a86cab2d7f0f157"),
    0
  );
  expect(result).toMatchObject({ sample: 22, success: false, rehashes: 0 });
});

test("rehashes when every chunk is rejected, like the program", async () => {
  const result = await verifyRoll(Array(32).fill(255), 0);
  expect(result.rehashes).toBe(1);
  expect(result.sample).toBe(0);
});

test("rejects malformed input", async () => {
  await expect(verifyRoll([1, 2, 3], 0)).rejects.toThrow();
  await expect(verifyRoll(Array(32).fill(1), 9)).rejects.toThrow();
});
