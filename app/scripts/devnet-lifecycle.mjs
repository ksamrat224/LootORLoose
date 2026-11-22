import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import anchor from "@coral-xyz/anchor";
import { ConnectionMagicRouter, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, BN, Program } = anchor;
const useSession = process.argv.includes("--session");

const idl = JSON.parse(readFileSync(new URL("../src/lib/loot_or_lose.json", import.meta.url), "utf8"));
const configuredKeypair = execFileSync("solana", ["config", "get"], { encoding: "utf8" }).match(/^Keypair Path:\s*(.+)$/m)?.[1];
const keypairPath = process.env.SOLANA_KEYPAIR || configuredKeypair;
if (!keypairPath) throw new Error("No configured Solana CLI keypair. Set SOLANA_KEYPAIR to a local keypair path.");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
const programId = new PublicKey(idl.address);
const base = new Connection("https://rpc.magicblock.app/devnet", "confirmed");
const router = new ConnectionMagicRouter("https://devnet-router.magicblock.app/", "confirmed");
const wallet = { publicKey: payer.publicKey, signTransaction: async (tx) => { tx.partialSign(payer); return tx; }, signAllTransactions: async (txs) => txs.map((tx) => { tx.partialSign(payer); return tx; }) };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = PublicKey.findProgramAddressSync([Buffer.from("profile"), payer.publicKey.toBuffer()], programId)[0];
const address = (index) => PublicKey.findProgramAddressSync([Buffer.from("run"), payer.publicKey.toBuffer(), new BN(index).toArrayLike(Buffer, "le", 8)], programId)[0];

function client(connection) {
  return new Program(idl, new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
}
async function account(connection, key, name) {
  const info = await connection.getAccountInfo(key, "confirmed");
  if (!info || !info.owner.equals(programId)) return null;
  return client(connection).coder.accounts.decode(name, info.data);
}
async function send(connection, label, tx, signer = payer, extraSigners = []) {
  tx.feePayer = signer.publicKey;
  const block = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = block.blockhash;
  tx.sign(signer, ...extraSigners);
  const simulated = await connection.simulateTransaction(tx);
  if (simulated.value.err) {
    console.error(`${label} simulation failed:`, JSON.stringify(simulated.value.err));
    console.error((simulated.value.logs || []).join("\n"));
    throw new Error(`${label} failed preflight simulation`);
  }
  console.log(`${label} simulation passed (${simulated.value.unitsConsumed ?? "?"} CU)`);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, ...block }, "confirmed");
  if (confirmation.value.err) throw new Error(`${label} ${signature}: ${JSON.stringify(confirmation.value.err)}`);
  console.log(`${label}: ${signature}`);
  return signature;
}
async function waitFor(label, check, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    const value = await check();
    if (value) return value;
    await sleep(1200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function route(run) {
  const status = await router.getDelegationStatus(run);
  if (!status.isDelegated || !status.fqdn) return null;
  return new Connection(status.fqdn.startsWith("http") ? status.fqdn : `https://${status.fqdn}`, "confirmed");
}
async function state(connection, run) { return account(connection, run, "runState"); }
function phase(run) { return Object.keys(run.phase)[0]; }
async function action(connection, run, index, label, build, signer = payer) {
  const current = await state(connection, run);
  if (!current) throw new Error(`${label}: ER state missing`);
  await send(connection, label, await build(client(connection), new BN(current.nonce)), signer);
  const updated = await state(connection, run);
  console.log(`${label} state: ${phase(updated)} at (${updated.x},${updated.y}), HP ${updated.hp}, pending ${updated.pending}, score ${updated.finalScore}`);
  return updated;
}
async function makeSession() {
  const manager = new SessionTokenManager(wallet, base);
  const signer = Keypair.generate();
  const token = PublicKey.findProgramAddressSync(
    [Buffer.from("session_token_v2"), programId.toBuffer(), signer.publicKey.toBuffer(), payer.publicKey.toBuffer()],
    manager.program.programId,
  )[0];
  const tx = await manager.program.methods
    .createSessionV2(true, new BN(Math.floor(Date.now() / 1000) + 240), new BN(2_000_000))
    .accounts({ targetProgram: programId, sessionSigner: signer.publicKey, feePayer: payer.publicKey, authority: payer.publicKey })
    .transaction();
  await send(base, "create four-minute session (0.002 devnet SOL top-up)", tx, payer, [signer]);
  if (!(await base.getAccountInfo(token))?.owner.equals(manager.program.programId)) throw new Error("Session token not readable on devnet");
  console.log(`Session token ${token}; signer ${signer.publicKey}`);
  return { signer, token };
}
async function main() {
  const onchain = await base.getAccountInfo(programId);
  if (!onchain?.executable) throw new Error("Program is not deployed and executable on devnet");
  console.log(`Program ${programId}; payer ${payer.publicKey}`);
  let record = await account(base, profile, "playerProfile");
  if (!record) {
    await send(base, "initialize profile", await client(base).methods.initializeProfile().accountsPartial({ profile, authority: payer.publicKey, systemProgram: SystemProgram.programId }).transaction());
    record = await account(base, profile, "playerProfile");
  }
  if (!record) throw new Error("Profile missing after initialization");
  for (const outcome of ["success", "failure"]) {
    const index = record.nextRunIndex.toNumber();
    const run = address(index);
    console.log(`\n${outcome.toUpperCase()} run ${index}: ${run}`);
    await send(base, "create run", await client(base).methods.createRun(new BN(index)).accountsPartial({ profile, run, authority: payer.publicKey, systemProgram: SystemProgram.programId }).transaction());
    await send(base, "delegate run", await client(base).methods.delegateRun(new BN(index)).accountsPartial({ authority: payer.publicKey, run }).transaction());
    const er = await waitFor("delegated ER account", async () => {
      const connection = await route(run);
      const erAccount = connection && await connection.getAccountInfo(run);
      return erAccount?.owner.equals(programId) ? connection : null;
    });
    const baseAccount = await base.getAccountInfo(run);
    console.log(`Delegated: base owner ${baseAccount?.owner}; ER owner ${(await er.getAccountInfo(run))?.owner}; ER ${er.rpcEndpoint}`);
    const session = useSession ? await makeSession() : null;
    const gameplaySigner = session?.signer || payer;
    const gameplayAccounts = { run, sessionToken: session?.token || programId, signer: gameplaySigner.publicKey };
    await action(er, run, index, "activate", (p) => p.methods.activateRun(new BN(index)).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
    await action(er, run, index, "advance to chest", (p, nonce) => p.methods.advance(new BN(index), nonce, Buffer.from([1, 1, 2])).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
    await action(er, run, index, "open chest 0", (p, nonce) => p.methods.openChest(new BN(index), nonce, 0).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
    await action(er, run, index, "advance through enemy zone", (p, nonce) => p.methods.advance(new BN(index), nonce, Buffer.from([1, 1, 1, 1, 1, 2, 2])).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
    if (outcome === "success") {
      await action(er, run, index, "advance to top-right", (p, nonce) => p.methods.advance(new BN(index), nonce, Buffer.from([0, 0, 1, 1, 1, 1, 1, 1])).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
      await action(er, run, index, "advance to exit", (p, nonce) => p.methods.advance(new BN(index), nonce, Buffer.from([2, 2, 2, 2, 2, 2])).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
      await action(er, run, index, "request extraction", (p, nonce) => p.methods.requestExtraction(new BN(index), nonce).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
    } else {
      const dead = await action(er, run, index, "take fatal damage", (p, nonce) => p.methods.advance(new BN(index), nonce, Buffer.from([2, 0, 2])).accountsPartial(gameplayAccounts).transaction(), gameplaySigner);
      if (phase(dead) !== "dead") throw new Error("Failure run did not die");
    }
    const erSignature = await send(er, "finalize", await client(er).methods.finalizeRun(new BN(index)).accountsPartial({ authority: payer.publicKey, run }).transaction());
    let commitmentSignature;
    try { commitmentSignature = await GetCommitmentSignature(erSignature, er); console.log(`Base commitment: ${commitmentSignature}`); }
    catch (error) { console.log(`Commit signature unavailable from logs: ${error.message}`); }
    if (commitmentSignature) {
      await waitFor("base commitment confirmation", async () => {
        const result = await base.getSignatureStatuses([commitmentSignature]);
        return result.value[0]?.confirmationStatus === "confirmed" || result.value[0]?.confirmationStatus === "finalized";
      });
    }
    const receipt = await waitFor("settled base receipt", async () => {
      const routed = await route(run);
      const data = await state(base, run);
      return !routed && data && phase(data) === (outcome === "success" ? "extracted" : "dead") ? data : null;
    });
    const expected = outcome === "success" ? 10 : 0;
    if (receipt.finalScore !== expected) throw new Error(`${outcome}: expected final score ${expected}, got ${receipt.finalScore}`);
    console.log(`VERIFIED ${outcome}: base phase ${phase(receipt)}, score ${receipt.finalScore}, HP ${receipt.hp}, run ${run}`);
    record = await account(base, profile, "playerProfile");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
