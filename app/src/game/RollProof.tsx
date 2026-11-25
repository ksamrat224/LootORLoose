"use client";

import { useEffect, useMemo, useState } from "react";
import type { Wager } from "@/lib/wager-chain";
import { GATES } from "./wager-rules";
import {
  isZeroRandomness,
  toHex,
  verifyRoll,
  type RollVerification,
} from "./verify-roll";

type Roll = {
  gate: number; // zero-based gate that was rolled
  cleared: boolean;
  randomness: string; // hex
  seconds: number | null; // request → fulfilment, whole seconds
};

const storageKey = (address: string) => `loot-rolls:${address}`;
const fromHex = (hex: string) =>
  Array.from({ length: 32 }, (_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  );

function load(address: string): Roll[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey(address)) ?? "[]"
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The program overwrites `wager.randomness` on every gate, so each roll must be
 * captured as it resolves. The bytes come from the on-chain account; this panel
 * only records them and lets the player recompute the outcome independently.
 */
function describe(run: Wager): Roll | null {
  if (run.phase === "randomnessPending" || isZeroRandomness(run.randomness))
    return null;
  const gate = run.phase === "lost" ? run.gate : run.gate - 1;
  if (gate < 0 || gate > 2) return null;
  const seconds =
    run.fulfilledAt && run.requestedAt && run.fulfilledAt >= run.requestedAt
      ? run.fulfilledAt - run.requestedAt
      : null;
  return {
    gate,
    cleared: run.phase !== "lost",
    randomness: toHex(run.randomness),
    seconds,
  };
}

export function RollProof({ run }: { run: Wager }) {
  const address = run.address.toBase58();
  const [store, setStore] = useState<{ address: string; rolls: Roll[] }>(
    () => ({
      address,
      rolls: load(address),
    })
  );
  const [checks, setChecks] = useState<
    Record<string, RollVerification | "error">
  >({});

  // Adjust state while rendering (React-recommended) instead of in an effect.
  const seen = store.address === address ? store.rolls : load(address);
  const rolls = useMemo(() => {
    const latest = describe(run);
    return latest && !seen.some((roll) => roll.randomness === latest.randomness)
      ? [...seen, latest]
      : seen;
  }, [run, seen]);
  if (rolls !== store.rolls || store.address !== address)
    setStore({ address, rolls });

  useEffect(() => {
    if (!rolls.length) return;
    try {
      localStorage.setItem(storageKey(address), JSON.stringify(rolls));
    } catch {
      /* storage unavailable: the panel still works for this session */
    }
  }, [address, rolls]);

  if (!rolls.length) return null;

  const verify = async (roll: Roll) => {
    try {
      const result = await verifyRoll(fromHex(roll.randomness), roll.gate);
      setChecks((c) => ({ ...c, [roll.randomness]: result }));
    } catch {
      setChecks((c) => ({ ...c, [roll.randomness]: "error" }));
    }
  };

  return (
    <div className="card roll-proof" data-testid="roll-proof">
      <p className="eyebrow">Proof of roll · MagicBlock VRF</p>
      {rolls.map((roll) => {
        const check = checks[roll.randomness];
        const gate = GATES[roll.gate];
        const matches =
          check && check !== "error" && check.success === roll.cleared;
        return (
          <div className="roll" key={roll.randomness}>
            <strong>
              Gate {roll.gate + 1} · {roll.cleared ? "cleared" : "failed"}
              {roll.seconds !== null && (
                <small> · fulfilled in ~{roll.seconds}s</small>
              )}
            </strong>
            <code title={roll.randomness}>
              {roll.randomness.slice(0, 16)}…{roll.randomness.slice(-8)}
            </code>
            <p className="muted">
              Clears if sample &lt; {gate.numerator} of {gate.denominator}.
            </p>
            {!check && (
              <button
                className="button secondary full"
                onClick={() => void verify(roll)}
              >
                Verify this roll in your browser
              </button>
            )}
            {check === "error" && (
              <p className="muted">Could not recompute this roll.</p>
            )}
            {check && check !== "error" && (
              <p className={matches ? "proof-ok" : "proof-bad"} role="status">
                {matches ? "✓ Match" : "✗ Mismatch"} — sample {check.sample} of{" "}
                {check.denominator} {check.success ? "<" : "≥"}{" "}
                {check.numerator}
                {" → "}
                {check.success ? "cleared" : "failed"}.
              </p>
            )}
          </div>
        );
      })}
      <p className="muted">
        Bytes are read from your wager account, where the VRF callback wrote
        them; the browser reruns the program&apos;s sampling rule.{" "}
        <a
          href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          Inspect account ↗
        </a>
      </p>
    </div>
  );
}
