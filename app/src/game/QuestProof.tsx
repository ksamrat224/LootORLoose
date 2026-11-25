"use client";
import { useState } from "react";
import { QUESTS } from "./quest-rules";
import { sampleRandomness, toHex } from "./verify-roll";
import type { Wager } from "@/lib/quest-chain";
export function QuestProof({ attempt }: { attempt: Wager }) {
  const [check, setCheck] = useState("");
  const q = QUESTS[attempt.questId];
  const bytes = toHex(attempt.randomness);
  if (
    attempt.randomness.length !== 32 ||
    attempt.phase === "randomnessPending" ||
    attempt.phase === "active" ||
    attempt.phase === "cancelled"
  )
    return <p>No resolved roll is available for this attempt.</p>;
  return (
    <div className="quest-proof">
      <p>{q.name} · MagicBlock VRF · rules V4</p>
      <code>{bytes}</code>
      <p>
        Fulfilled:{" "}
        {attempt.fulfilledAt
          ? new Date(attempt.fulfilledAt * 1000).toLocaleString()
          : "Timestamp unavailable"}
      </p>
      <button
        className="q-button"
        onClick={async () => {
          try {
            const { value } = await sampleRandomness(
              attempt.randomness,
              q.denominator
            );
            const cleared = value < q.numerator;
            setCheck(
              `${
                cleared === (attempt.phase === "succeeded")
                  ? "Match"
                  : "Mismatch"
              } · sample ${value} of ${q.denominator} ${cleared ? "<" : "≥"} ${
                q.numerator
              } → ${cleared ? "cleared" : "failed"}`
            );
          } catch {
            setCheck("Could not recompute this roll. Try again.");
          }
        }}
      >
        Verify this roll in your browser
      </button>
      <p role="status">{check}</p>
      <p>
        Bytes come from this attempt’s account. The browser recomputes the
        program’s sampling rule.
      </p>
      <a
        href={`https://explorer.solana.com/address/${attempt.address.toBase58()}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
      >
        Inspect attempt account ↗
      </a>
    </div>
  );
}
