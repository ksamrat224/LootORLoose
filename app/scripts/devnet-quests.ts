import { QUESTS, approachPath, questReturn } from "../src/game/quest-rules";
import { sampleRandomness } from "../src/game/verify-roll";
import { readPlayer as readV3Player } from "../src/lib/wager-chain";
/** Bounded live verification. Every attempt is a new, normally settled wager; never reroll a gate. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { base, createGameSession, PROGRAM_ID } from "../src/lib/chain";
import {
  authorizeWagerSession,
  createWager,
  delegateWager,
  initializeLedger,
  readHouse,
  readPlayer,
  readWager,
  settleWager,
  terminal,
  wagerAction,
  waitForEr,
  type Wager,
} from "../src/lib/quest-chain";

const configured = execFileSync("solana", ["config", "get"], {
  encoding: "utf8",
})
  .match(/^Keypair Path:\s*(.+)$/m)?.[1]
  ?.trim();
const keypairPath = process.env.SOLANA_KEYPAIR || configured;
if (!keypairPath) throw new Error("No configured CLI wallet");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")))
);
const wallet = {
  publicKey: payer.publicKey,
  signTransaction: async <T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> => {
    if (tx instanceof Transaction) tx.partialSign(payer);
    else tx.sign([payer]);
    return tx;
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> =>
    Promise.all(txs.map(async (tx) => wallet.signTransaction(tx))),
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function state(index: number): Promise<Wager> {
  const value = await readWager(wallet, index);
  if (!value) throw new Error(`Run ${index} is not readable yet`);
  return value;
}
async function waitForResult(index: number) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await state(index);
    if (value.phase !== "randomnessPending") return value;
    await pause(1000);
  }
  throw new Error(
    `Run ${index}: VRF remains pending; preserve this request and rerun recovery later. No new gate was requested.`
  );
}
async function main() {
  console.log(
    `DEVNET ONLY · program ${PROGRAM_ID} · wallet ${payer.publicKey}`
  );
  const deployed = await base.getAccountInfo(PROGRAM_ID);
  if (
    !deployed?.executable ||
    deployed.data.length !== 36 ||
    deployed.data.readUInt32LE(0) !== 2
  )
    throw new Error("Expected the upgradeable base-layer program");
  const programData = await base.getAccountInfo(
    new PublicKey(deployed.data.subarray(4, 36))
  );
  const binary = readFileSync(
    new URL("../../target/deploy/loot_or_lose.so", import.meta.url)
  );
  const hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  if (
    !programData ||
    !programData.owner.equals(deployed.owner) ||
    programData.data.length < binary.length + 45 ||
    hash(programData.data.subarray(45, 45 + binary.length)) !== hash(binary)
  )
    throw new Error(
      "The local wager binary is not deployed on base devnet. No wager transactions were sent."
    );

  if (!process.argv.includes("--send")) {
    console.log(
      "Binary check passed. Read-only verification finished; use --send for bounded demo attempts and devnet SOL fees."
    );
    return;
  }
  const option = process.argv.find((arg) => arg.startsWith("--quest="));
  const questId = option ? Number(option.slice(8)) : 0;
  if (!Number.isInteger(questId) || !QUESTS[questId])
    throw new Error("Use --quest=0 through --quest=5");
  const legacy = await readV3Player(wallet);
  if (legacy?.active)
    throw new Error(
      "Recover the unresolved V3 run before creating a V4 attempt"
    );
  console.log(
    `V4 ${QUESTS[questId].name}: $2 demo stakes, up to 12 attempts, 0.002 devnet SOL/session plus network fees. Each attempt settles before another starts.`
  );
  await initializeLedger(wallet);
  const observed = new Set<string>();
  const existing = await readPlayer(wallet);
  for (let index = 0; index < (existing?.nextIndex.toNumber() ?? 0); index++) {
    const receipt = await readWager(wallet, index, true);
    if (
      receipt?.settled &&
      receipt.rulesVersion === 4 &&
      receipt.questId === questId &&
      receipt.stake === 200 &&
      ["succeeded", "lost"].includes(receipt.phase)
    )
      observed.add(receipt.phase);
  }
  for (let round = 0; round < 12; round++) {
    const player = await readPlayer(wallet);
    if (!player?.active && observed.size === 2) break;
    const index = player?.active
      ? player.activeIndex.toNumber()
      : await createWager(wallet, 200, 255, []);
    let value = await state(index);
    if (value.phase === "active") {
      if (!value.delegated) {
        await delegateWager(wallet, index);
        await waitForEr(wallet, index);
        value = await state(index);
      }
      const session = (await createGameSession(wallet)).session;
      await authorizeWagerSession(wallet, value, session);
      await wagerAction(
        wallet,
        value,
        session,
        "risk",
        questId,
        approachPath(QUESTS[questId])
      );
      value = await waitForResult(index);
    } else if (value.phase === "randomnessPending")
      value = await waitForResult(index);
    if (!terminal(value))
      throw new Error("Attempt is unresolved; preserve it before proceeding");
    const before = await readPlayer(wallet);
    await settleWager(wallet, value, console.log);
    const receipt = await readWager(wallet, index, true),
      after = await readPlayer(wallet),
      house = await readHouse(wallet);
    if (
      !receipt?.settled ||
      !after ||
      after.active ||
      !house ||
      house.balance.lt(house.reserved)
    )
      throw new Error("V4 settlement invariant failed");
    const expected =
      receipt.phase === "succeeded"
        ? questReturn(receipt.stake, receipt.questId)
        : receipt.phase === "cancelled"
        ? receipt.stake
        : 0;
    if (
      receipt.payout !== expected ||
      (!value.settled &&
        before &&
        after.balance.toNumber() !== before.balance.toNumber() + expected)
    )
      throw new Error("V4 payout or credit mismatch");
    if (["succeeded", "lost"].includes(receipt.phase)) {
      const rules = QUESTS[receipt.questId];
      const sample = await sampleRandomness(
        receipt.randomness,
        rules.denominator
      );
      if (sample.value < rules.numerator !== (receipt.phase === "succeeded"))
        throw new Error("VRF proof recomputation mismatch");
      if (receipt.questId === questId && receipt.stake === 200)
        observed.add(receipt.phase);
    }
    console.log(
      `VERIFIED ${receipt.phase}: quest ${receipt.questId}; account ${
        receipt.address
      }; payout ${receipt.payout}; player ${after.balance}; reserved ${
        house.reserved
      }; randomness ${Buffer.from(receipt.randomness).toString("hex")}`
    );
  }
  if (observed.size !== 2)
    throw new Error(
      "Bounded sample did not observe both outcomes. No odds changed or requests rerolled."
    );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
