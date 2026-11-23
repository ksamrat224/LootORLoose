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
import {
  base,
  createGameSession,
  PROGRAM_ID,
  type GameSession,
} from "../src/lib/chain";
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
} from "../src/lib/wager-chain";

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
  console.log(
    "$2 demo stakes; maximum 12 distinct wagers. Each is settled before another starts. One temporary session top-up is 0.002 devnet SOL."
  );
  await initializeLedger(wallet);
  let session: GameSession | undefined;
  const observed = new Set<string>();
  for (let attempt = 0; attempt < 12 && observed.size < 2; attempt++) {
    const player = await readPlayer(wallet);
    if (!player) throw new Error("Missing demo player");
    const index = player.active
      ? player.activeIndex.toNumber()
      : await createWager(wallet, 200);
    let value = await state(index);
    console.log(
      `Run ${index}: ${value.address} · stake ${value.stake} · ${value.phase}`
    );
    if (!terminal(value) && !value.delegated) {
      await delegateWager(wallet, index);
      await waitForEr(wallet, index);
      value = await state(index);
    }
    if (value.phase === "active") {
      if (!session || session.expiresAt <= Math.floor(Date.now() / 1000) + 30)
        session = (await createGameSession(wallet)).session;
      await authorizeWagerSession(wallet, value, session);
      if (value.gate === 0) {
        // Recover an unrequested run from any confirmed tile using a bounded map path.
        const target = { x: 3, y: 2 };
        const queue: { x: number; y: number; path: number[] }[] = [
          { x: value.x, y: value.y, path: [] },
        ];
        const seen = new Set<string>();
        let path: number[] | undefined;
        const walls = new Set(["5,3", "5,4", "5,5", "10,3", "10,4", "10,5"]);
        while (queue.length) {
          const point = queue.shift()!;
          const key = `${point.x},${point.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (point.x === target.x && point.y === target.y) {
            path = point.path;
            break;
          }
          [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ].forEach(([dx, dy], direction) => {
            const x = point.x + dx,
              y = point.y + dy;
            if (x > 0 && x < 15 && y > 0 && y < 9 && !walls.has(`${x},${y}`))
              queue.push({ x, y, path: [...point.path, direction] });
          });
        }
        if (!path) throw new Error("No valid path to gate 1");
        while (path.length) {
          await wagerAction(
            wallet,
            value,
            session,
            "advance",
            path.splice(0, 12)
          );
          value = await state(index);
        }
        await wagerAction(wallet, value, session, "risk");
        value = await waitForResult(index);
      }
      if (value.phase === "active" && value.gate > 0) {
        await wagerAction(wallet, value, session, "extract");
        value = await state(index);
      }
    } else if (value.phase === "randomnessPending")
      value = await waitForResult(index);
    if (value.phase === "active" && value.gate > 0) {
      if (!session) session = (await createGameSession(wallet)).session;
      await authorizeWagerSession(wallet, value, session);
      await wagerAction(wallet, value, session, "extract");
      value = await state(index);
    }
    if (!terminal(value))
      throw new Error("Run is not terminal; do not create another wager");
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
      throw new Error("Base settlement invariant failed");
    const outcome =
      receipt.phase === "lost"
        ? "failure"
        : receipt.phase === "extracting"
        ? "success"
        : "cancelled";
    if (
      outcome === "success" &&
      receipt.payout !==
        Math.floor(receipt.stake * [1, 1.25, 2, 3][receipt.gate])
    )
      throw new Error("Unexpected payout");
    if (outcome === "failure" && receipt.payout !== 0)
      throw new Error("Failure credited a payout");
    if (outcome !== "cancelled") observed.add(outcome);
    console.log(
      `VERIFIED ${outcome}: base run ${receipt.address}; gate ${
        receipt.gate
      }; payout cents ${receipt.payout}; player balance ${
        after.balance
      }; house ${house.balance}; reserved ${
        house.reserved
      }; randomness ${Buffer.from(receipt.randomness).toString("hex")}`
    );
  }
  console.log(
    `Wallet devnet SOL balance: ${
      (await base.getBalance(payer.publicKey)) / 1e9
    }`
  );
  if (observed.size !== 2)
    throw new Error(
      "The bounded live sample did not observe both outcomes. Do not change odds or reroll to force them."
    );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
