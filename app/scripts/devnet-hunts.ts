import { QUESTS, approachPath } from "../src/game/hunt-rules";
import { verifyHunt } from "../src/game/HuntProof";
import { readPlayer as readV4Player } from "../src/lib/quest-chain";
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
} from "../src/lib/hunt-chain";

const configured = execFileSync("solana", ["config", "get"], {
  encoding: "utf8",
})
  .match(/^Keypair Path:\s*(.+)$/m)?.[1]
  ?.trim();
const keypairPath = process.env.SOLANA_KEYPAIR || configured;
if (!keypairPath) throw new Error("No configured CLI wallet");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))),
);
const wallet = {
  publicKey: payer.publicKey,
  signTransaction: async <T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> => {
    if (tx instanceof Transaction) tx.partialSign(payer);
    else tx.sign([payer]);
    return tx;
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> =>
    Promise.all(txs.map(async (tx) => wallet.signTransaction(tx))),
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function state(index: number): Promise<Wager> {
  const value = await readWager(wallet, index);
  if (!value) throw new Error(`Run ${index} is not readable yet`);
  return value;
}
async function waitForResult(index: number, expectedCount: number) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await state(index);
    if (
      value.revealCount >= expectedCount &&
      value.phase !== "randomnessPending"
    )
      return value;
    await pause(1000);
  }
  throw new Error(
    `Run ${index}: VRF remains pending; preserve this request and rerun recovery later. No new reveal was requested.`,
  );
}
async function main() {
  console.log(
    `DEVNET ONLY · program ${PROGRAM_ID} · wallet ${payer.publicKey}`,
  );
  const deployed = await base.getAccountInfo(PROGRAM_ID);
  if (
    !deployed?.executable ||
    deployed.data.length !== 36 ||
    deployed.data.readUInt32LE(0) !== 2
  )
    throw new Error("Expected the upgradeable base-layer program");
  const programData = await base.getAccountInfo(
    new PublicKey(deployed.data.subarray(4, 36)),
  );
  const binary = readFileSync(
    new URL("../../target/deploy/loot_or_lose.so", import.meta.url),
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
      "The local hunt binary is not deployed on base devnet. No hunt transactions were sent.",
    );

  if (!process.argv.includes("--send")) {
    console.log(
      "Binary check passed. Read-only verification finished; use --send for bounded demo hunts and devnet SOL fees.",
    );
    return;
  }
  const option = process.argv.find((arg) => arg.startsWith("--quests="));
  const order = option ? option.slice(9).split(",").map(Number) : [0, 1, 2];
  if (
    order.length !== 3 ||
    new Set(order).size !== 3 ||
    order.some((id) => !Number.isInteger(id) || !QUESTS[id])
  )
    throw new Error(
      "Use --quests=0,1,2 with three distinct IDs from 0 through 5",
    );
  const [legacy, oldQuest] = await Promise.all([
    readV3Player(wallet),
    readV4Player(wallet),
  ]);
  if (legacy?.active || oldQuest?.active)
    throw new Error(
      "Recover unresolved V3/V4 accounts before creating V5 credits",
    );
  console.log(
    "V5: up to 12 normally completed $2 demo hunts; 0.002 devnet SOL/session plus network fees. Never reroll a pending reveal.",
  );
  await initializeLedger(wallet);
  const observed = new Set<string>();
  for (let round = 0; round < 12; round++) {
    const player = await readPlayer(wallet);
    if (!player?.active && observed.size === 2) break;
    const index = player?.active
      ? player.activeIndex.toNumber()
      : await createWager(wallet, 200);
    let value = await state(index);
    let session:
      | Awaited<ReturnType<typeof createGameSession>>["session"]
      | null = null;
    while (!terminal(value)) {
      if (value.phase === "randomnessPending") {
        value = await waitForResult(index, value.revealCount + 1);
        continue;
      }
      if (!value.delegated) {
        await delegateWager(wallet, index);
        await waitForEr(wallet, index);
        value = await state(index);
      }
      if (!session || session.expiresAt <= Date.now() / 1000) {
        session = (await createGameSession(wallet)).session;
        await authorizeWagerSession(wallet, value, session);
      }
      const id = [...order, ...QUESTS.map((q) => q.id)].find(
        (id) => !(value.openedMask & (1 << id)),
      );
      if (id === undefined)
        throw new Error("No unopened quest remains in an active hunt");
      await wagerAction(
        wallet,
        value,
        session,
        "risk",
        id,
        approachPath(QUESTS[id], { x: value.x, y: value.y }),
      );
      value = await waitForResult(index, value.revealCount + 1);
    }
    if (!(await verifyHunt(value)))
      throw new Error("V5 reward proof mismatch before settlement");
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
      house.balance.lt(house.reserved) ||
      !(await verifyHunt(receipt))
    )
      throw new Error("V5 settlement invariant or proof mismatch");
    if (
      !value.settled &&
      before &&
      after.balance.toNumber() !== before.balance.toNumber() + receipt.payout
    )
      throw new Error("V5 balance credit mismatch");
    for (const reveal of receipt.reveals)
      observed.add(reveal.reward ? "positive" : "zero");
    console.log(
      `VERIFIED hunt ${receipt.address}: ${receipt.revealCount} reveals, payout ${receipt.payout}, balance ${after.balance}, reserve ${house.reserved}`,
    );
  }
  if (observed.size !== 2)
    throw new Error(
      "Bounded sample did not observe both zero and positive reveals. No rewards or requests were changed.",
    );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
