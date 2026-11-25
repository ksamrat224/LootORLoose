"use client";
import { useState } from "react";
import type { Wager } from "@/lib/hunt-chain";
import { QUESTS, huntReward } from "./hunt-rules";
import { sampleRandomness, toHex } from "./verify-roll";
import { money } from "./wager-rules";
export async function verifyHunt(
  attempt: Pick<
    Wager,
    "reveals" | "revealCount" | "openedMask" | "stake" | "payout" | "phase"
  >,
) {
  if (attempt.phase === "cancelled")
    return (
      attempt.revealCount === 0 &&
      attempt.openedMask === 0 &&
      attempt.payout === attempt.stake
    );
  if (
    attempt.revealCount < 1 ||
    attempt.revealCount > 3 ||
    attempt.reveals.length !== attempt.revealCount ||
    (attempt.phase === "complete" && attempt.revealCount !== 3)
  )
    return false;
  let mask = 0,
    total = 0;
  for (const reveal of attempt.reveals) {
    if (!QUESTS[reveal.questId] || mask & (1 << reveal.questId)) return false;
    const { value } = await sampleRandomness(reveal.randomness, 100);
    const reward = huntReward(attempt.stake, value);
    if (value !== reveal.bucket || reward !== reveal.reward) return false;
    mask |= 1 << reveal.questId;
    total += reward;
  }
  return mask === attempt.openedMask && total === attempt.payout;
}
export function HuntProof({ attempt }: { attempt: Wager }) {
  const [check, setCheck] = useState("");
  if (!attempt.revealCount)
    return <p>No resolved reveals are available for this hunt.</p>;
  return (
    <div className="quest-proof">
      <p>MagicBlock VRF · rules V5 · {attempt.revealCount}/3 reveals</p>
      {attempt.reveals.map((r, i) => (
        <details key={i}>
          <summary>
            {i + 1}. {QUESTS[r.questId].name} · {money(r.reward)}
          </summary>
          <code>{toHex(r.randomness)}</code>
          <p>
            Bucket {r.bucket} of 100 · reward {money(r.reward)} demo credits
          </p>
        </details>
      ))}
      <button
        className="q-button"
        onClick={async () => {
          try {
            setCheck(
              (await verifyHunt(attempt))
                ? "Match · all reveal rewards and their sum verified"
                : "Mismatch · proof or total differs",
            );
          } catch {
            setCheck("Could not recompute these reveals. Try again.");
          }
        }}
      >
        Verify all reveals in your browser
      </button>
      <p role="status">{check}</p>
      <p>
        Persisted hunt bytes reproduce the rewards and their sum; this does not
        verify the oracle signature in the browser.
      </p>
      <a
        href={`https://explorer.solana.com/address/${attempt.address.toBase58()}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
      >
        Inspect hunt account ↗
      </a>
    </div>
  );
}
