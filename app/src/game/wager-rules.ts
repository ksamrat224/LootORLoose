export const GATES = [
  {
    x: 4,
    y: 2,
    name: "The Copper Watch",
    numerator: 19,
    denominator: 25,
    odds: "76%",
    multiplier: "1.25×",
    color: "copper",
  },
  {
    x: 8,
    y: 7,
    name: "The Emerald Maw",
    numerator: 5,
    denominator: 8,
    odds: "62.5%",
    multiplier: "2×",
    color: "emerald",
  },
  {
    x: 12,
    y: 2,
    name: "The Crown Vault",
    numerator: 2,
    denominator: 3,
    odds: "66⅔%",
    multiplier: "3×",
    color: "crown",
  },
] as const;
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export function parseStake(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents >= 100 && cents <= 10000 ? cents : null;
}
export function gateReturn(stake: number, gate: number): number {
  if (!Number.isSafeInteger(stake) || stake < 0 || gate < 0 || gate > 3)
    throw new Error("Invalid payout");
  return Math.floor(stake * [1, 1.25, 2, 3][gate]);
}
