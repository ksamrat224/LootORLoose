import { test, expect } from "@playwright/test";
import { Checkpoints } from "../src/game/checkpoints";
import { gateReturn, parseStake, GATES } from "../src/game/wager-rules";

test("movement submitted during latency survives reconciliation without snapping", () => {
  const queue = new Checkpoints(
    { x: 1, y: 1 },
    (x, y) => x > 0 && x < 15 && y > 0 && y < 9
  );
  queue.enqueue(1);
  queue.enqueue(1);
  expect(queue.begin(7)?.path).toEqual([1, 1]);
  queue.enqueue(2);
  queue.enqueue(2);
  expect(queue.predict()).toEqual({ x: 3, y: 3 });
  queue.confirm({ x: 3, y: 1 }, 8);
  expect(queue.predict()).toEqual({ x: 3, y: 3 });
  expect(queue.begin(8)?.path).toEqual([2, 2]);
  queue.confirm({ x: 3, y: 3 }, 9);
  expect(queue.predict()).toEqual({ x: 3, y: 3 });
});
test("uncertain actions freeze inputs and cannot be submitted twice", () => {
  const queue = new Checkpoints({ x: 1, y: 1 }, () => true);
  queue.enqueue(1);
  queue.begin(0);
  queue.uncertain = true;
  expect(queue.enqueue(2)).toBe(false);
  expect(queue.begin(0)).toBeNull();
  expect(() => queue.confirm({ x: 1, y: 1 }, 0)).toThrow();
  queue.confirm({ x: 2, y: 1 }, 1);
  expect(queue.enqueue(2)).toBe(true);
});
test("slow confirmations buffer movement while transactions stay within twelve steps", () => {
  const queue = new Checkpoints({ x: 0, y: 0 }, () => true);
  for (let i = 0; i < 12; i++) queue.enqueue(1);
  expect(queue.begin(0)?.path).toHaveLength(12);
  for (let i = 0; i < 36; i++) expect(queue.enqueue(1)).toBe(true);
  expect(queue.enqueue(1)).toBe(false);
  expect(queue.predict()).toEqual({ x: 48, y: 0 });
  queue.confirm({ x: 12, y: 0 }, 1);
  expect(queue.predict()).toEqual({ x: 48, y: 0 });
  expect(queue.begin(1)?.path).toHaveLength(12);
});
test("failed and terminal checkpoints discard unsafe pending paths", () => {
  const queue = new Checkpoints({ x: 1, y: 1 }, (x) => x !== 4);
  queue.enqueue(1);
  queue.begin(0);
  queue.enqueue(2);
  queue.reject({ x: 1, y: 1 });
  expect(queue.predict()).toEqual({ x: 1, y: 1 });
  queue.enqueue(2);
  queue.begin(1);
  queue.enqueue(1);
  queue.confirm({ x: 1, y: 2 }, 2, false);
  expect(queue.queued).toEqual([]);
});
test("stakes use integer cents and payout ladders preserve the stated expected return", () => {
  for (const value of ["0.99", "100.01", "2.001", "1e2", "-5", "NaN", ""])
    expect(parseStake(value)).toBeNull();
  expect(parseStake("1.01")).toBe(101);
  expect(parseStake("100")).toBe(10000);
  expect(gateReturn(501, 1)).toBe(626);
  expect(gateReturn(500, 2)).toBe(1000);
  expect(gateReturn(500, 3)).toBe(1500);
  let probability = 1;
  GATES.forEach((gate, index) => {
    probability *= gate.numerator / gate.denominator;
    expect((probability * gateReturn(10000, index + 1)) / 10000).toBeCloseTo(
      0.95,
      12
    );
  });
});
