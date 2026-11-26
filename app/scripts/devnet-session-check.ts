/** Devnet-only session revocation/propagation check. Every accepted request is preserved. */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  base,
  program,
  PROGRAM_ID,
  createGameSession,
  revokeGameSession,
  resolveEr,
  submit,
} from "../src/lib/chain";
import {
  prepareHunt,
  readWager,
  readPlayer,
  settleWager,
  wagerAction,
  authorizeWagerSession,
  terminal,
} from "../src/lib/hunt-chain";
import { watchHunt } from "../src/lib/hunt-watch";
import { QUESTS, approachPath } from "../src/game/hunt-rules";
import { verifyHunt } from "../src/game/HuntProof";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  if (
    !process.argv.includes("--send") ||
    process.env.NEXT_PUBLIC_NETWORK !== "devnet"
  )
    throw new Error(
      "Use --send on devnet only; funds one temporary wallet with 0.03 devnet SOL",
    );
  const deployed = await base.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable || deployed.data.readUInt32LE(0) !== 2)
    throw new Error("Expected upgradeable program");
  const data = await base.getAccountInfo(
    new PublicKey(deployed.data.subarray(4, 36)),
  );
  const binary = readFileSync(
    new URL("../../target/deploy/loot_or_lose.so", import.meta.url),
  );
  const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
  if (
    !data ||
    hash(data.data.subarray(45, 45 + binary.length)) !== hash(binary)
  )
    throw new Error("Binary mismatch; no funding sent");
  const path =
    process.env.SOLANA_KEYPAIR ||
    execFileSync("solana", ["config", "get"], { encoding: "utf8" })
      .match(/^Keypair Path:\s*(.+)$/m)?.[1]
      ?.trim();
  if (!path) throw new Error("No configured devnet fee payer");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
  const tag = process.env.LIVE_SESSION_WALLET_TAG || randomUUID();
  const fresh = Keypair.fromSeed(
    createHmac("sha256", payer.secretKey)
      .update(`loot:session-check:v1:${tag}`)
      .digest(),
  );
  let approvals = 0;
  const walletFor = (key: Keypair) => ({
    publicKey: key.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> => {
      if (key === fresh) approvals++;
      if (tx instanceof Transaction) tx.partialSign(key);
      else tx.sign([key]);
      return tx;
    },
    signAllTransactions: async <
      T extends Transaction | VersionedTransaction,
    >(): Promise<T[]> => {
      throw new Error("Not used");
    },
  });
  const wallet = walletFor(fresh);
  console.log(
    "SESSION_CHECK_WALLET",
    fresh.publicKey.toBase58(),
    "PUBLIC_RECOVERY_TAG",
    tag,
  );
  let player = await readPlayer(wallet);
  if (player && !player.active) {
    console.log(
      "This tagged check is already settled; no new hunt or funding sent.",
    );
    return;
  }
  const fundingNeeded = Math.max(
    0,
    30_000_000 - (await base.getBalance(wallet.publicKey)),
  );
  if (!player && fundingNeeded)
    console.log(
      "FUNDING",
      await submit(
        base,
        walletFor(payer),
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: fresh.publicKey,
            lamports: fundingNeeded,
          }),
        ),
      ),
    );
  let activeSession = null;
  let index = player?.active ? player.activeIndex.toNumber() : undefined;
  try {
    if (index === undefined) {
      const prepared = await prepareHunt(wallet, 200, console.log);
      index = prepared.index;
      activeSession = prepared.session;
      if (approvals !== 1)
        throw new Error(`Preparation required ${approvals} approvals`);
      console.log("ONE_APPROVAL_PREPARATION_VERIFIED");
    } else activeSession = (await createGameSession(wallet)).session;
    const get = async () => {
      const state = await readWager(wallet, index!);
      if (!state) throw new Error("Missing hunt");
      return state;
    };
    let state = await get();
    const observed: { nonce: number; count: number; at: number }[] = [];
    const stop = watchHunt(
      wallet,
      index,
      (value) =>
        observed.push({
          nonce: value.nonce,
          count: value.revealCount,
          at: Date.now(),
        }),
      console.log,
    );
    try {
      if (state.revealCount === 0 && state.phase === "active") {
        if (!state.sessionSigner?.equals(activeSession.signer.publicKey)) {
          await authorizeWagerSession(wallet, state, activeSession);
          state = await get();
        }
        const route = await resolveEr(state.address);
        if (!route.connection) throw new Error("Expected ER");
        const er = program(route.connection, wallet);
        const requestNonce = state.nonce + 1;
        const request = await er.methods
          .riskHunt(
            new BN(index),
            new BN(state.nonce),
            0,
            Buffer.from(approachPath(QUESTS[0], { x: state.x, y: state.y })),
          )
          .accountsPartial({
            wager: state.address,
            sessionToken: PROGRAM_ID, // Anchor's sentinel for an omitted optional account.
            signer: wallet.publicKey,
            oracleQueue: new PublicKey(
              "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
            ),
          })
          .instruction();
        const revoke = await er.methods
          .revokeHuntSession(new BN(index))
          .accountsPartial({
            wager: state.address,
            authority: wallet.publicKey,
          })
          .instruction();
        // Both run atomically: the accepted request is pending when permission is removed.
        console.log(
          "PENDING_RUNTIME_REVOKE",
          await submit(
            route.connection,
            wallet,
            new Transaction().add(request, revoke),
          ),
        );
        const blocked = await get();
        if (
          !blocked.sessionSigner?.equals(PublicKey.default) ||
          blocked.requestNonce !== requestNonce
        )
          throw new Error(
            "Revocation changed request identity or retained signer",
          );
        const quest = QUESTS.find((q) => !(blocked.openedMask & (1 << q.id)))!;
        let rejected = false;
        try {
          await wagerAction(
            wallet,
            blocked,
            activeSession,
            "risk",
            quest.id,
            approachPath(quest, { x: blocked.x, y: blocked.y }),
          );
        } catch (error) {
          rejected =
            String(error).includes("Preflight simulation failed") ||
            String(error).includes("ER action simulation failed");
          console.log("OLD_KEY_REJECTION", String(error));
        }
        if (!rejected)
          throw new Error("Old session was not rejected by the program");
        console.log(
          "BASE_TOKEN_REVOKE",
          await revokeGameSession(wallet, activeSession.token),
        );
        if (await base.getAccountInfo(activeSession.token))
          throw new Error("Base token still exists");
        let propagated = false;
        for (let i = 0; i < 20; i++) {
          if (!(await route.connection.getAccountInfo(activeSession.token))) {
            propagated = true;
            break;
          }
          await pause(1000);
        }
        console.log(
          "BASE_TOKEN_CLOSED",
          true,
          "ER_TOKEN_CLOSURE_OBSERVED",
          propagated,
        );
        for (let tick = 0; tick < 120; tick++) {
          state = await get();
          if (state.revealCount >= 1) break;
          await pause(1000);
        }
        if (
          state.revealCount !== 1 ||
          state.requestNonce !== requestNonce ||
          !(await verifyHunt(state))
        )
          throw new Error("Accepted callback did not survive revocation");
        console.log(
          "ACCEPTED_CALLBACK_PRESERVED",
          state.address.toBase58(),
          state.reveals[0],
        );
        activeSession = (await createGameSession(wallet)).session;
      }
      while (!terminal(state)) {
        const before = state.revealCount;
        if (state.phase === "active") {
          await authorizeWagerSession(wallet, state, activeSession);
          const quest = QUESTS.find((q) => !(state.openedMask & (1 << q.id)))!;
          await wagerAction(
            wallet,
            state,
            activeSession,
            "risk",
            quest.id,
            approachPath(quest, { x: state.x, y: state.y }),
          );
        }
        for (let tick = 0; tick < 120; tick++) {
          state = await get();
          if (state.revealCount > before || terminal(state)) break;
          await pause(1000);
        }
        if (state.revealCount === before && !terminal(state))
          throw new Error(
            "Pending request retained; rerun with the same PUBLIC_RECOVERY_TAG",
          );
      }
      await settleWager(wallet, state, console.log);
      const settled = await readWager(wallet, index, true);
      player = await readPlayer(wallet);
      if (
        !settled?.settled ||
        !(await verifyHunt(settled)) ||
        player?.active ||
        player?.balance.toNumber() !== 9800 + settled.payout
      )
        throw new Error("Settlement mismatch");
      console.log(
        "SESSION_CHECK_SETTLED",
        JSON.stringify({
          wallet: wallet.publicKey.toBase58(),
          hunt: settled.address.toBase58(),
          return: settled.payout,
          balance: player.balance.toNumber(),
          approvals,
          observed,
        }),
      );
    } finally {
      stop();
    }
  } finally {
    player = await readPlayer(wallet).catch(() => null);
    if (!player?.active) {
      const balance = await base.getBalance(wallet.publicKey);
      if (balance > 5000)
        console.log(
          "FUNDING_RETURN",
          await submit(
            base,
            wallet,
            new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: payer.publicKey,
                lamports: balance - 5000,
              }),
            ),
          ),
        );
    } else
      console.log(
        "UNRESOLVED_HUNT_RETAINED",
        wallet.publicKey.toBase58(),
        "rerun with LIVE_SESSION_WALLET_TAG=" + tag,
      );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
