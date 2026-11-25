import { GATES } from "./wager-rules";

/**
 * Independent re-implementation of the on-chain `wager::sample` rejection
 * sampler (programs/loot_or_lose/src/wager.rs). Given the 32 VRF bytes the
 * program persisted, it recomputes the outcome so anyone can check the roll.
 */
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const REJECTION_DOMAIN = new TextEncoder().encode("loot-gate-rejection-v1");

export type RollVerification = {
  gate: number; // zero-based gate index that was rolled
  sample: number; // value in [0, denominator)
  numerator: number;
  denominator: number;
  success: boolean;
  rehashes: number; // rejection-sampling rounds needed (almost always 0)
};

export const toHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const isZeroRandomness = (bytes: ArrayLike<number>) =>
  bytes.length !== 32 || Array.from(bytes).every((b) => !b);

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

export async function sampleRandomness(
  seed: ArrayLike<number>,
  denominator: number
): Promise<{ value: number; rehashes: number }> {
  if (seed.length !== 32) throw new Error("Randomness must be 32 bytes");
  const d = BigInt(denominator);
  const limit = U64_MAX - (U64_MAX % d);
  let bytes = Uint8Array.from(seed);
  for (let rehashes = 0; ; rehashes++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 32);
    for (let i = 0; i < 32; i += 8) {
      const value = view.getBigUint64(i, true);
      if (value < limit) return { value: Number(value % d), rehashes };
    }
    bytes = await sha256(REJECTION_DOMAIN, bytes);
  }
}

export async function verifyRoll(
  randomness: ArrayLike<number>,
  gate: number
): Promise<RollVerification> {
  const rules = GATES[gate];
  if (!rules) throw new Error("Unknown gate");
  const { value, rehashes } = await sampleRandomness(
    randomness,
    rules.denominator
  );
  return {
    gate,
    sample: value,
    numerator: rules.numerator,
    denominator: rules.denominator,
    success: value < rules.numerator,
    rehashes,
  };
}
