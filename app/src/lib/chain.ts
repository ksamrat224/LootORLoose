import { AnchorProvider, BN, Idl, Program, utils } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import {
  ConnectionMagicRouter,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import idl from "./loot_or_lose.json";

export const BASE_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://rpc.magicblock.app/devnet";
export const ROUTER_URL =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL ||
  "https://devnet-router.magicblock.app/";
export const PROGRAM_ID = new PublicKey(idl.address);
export const DEPLOYED_ID = process.env.NEXT_PUBLIC_GAME_PROGRAM_ID;
// The checked-in IDL is newer than the currently deployed devnet program until an explicit upgrade.
export const isConfigured = Boolean(
  process.env.NEXT_PUBLIC_GAME_V2_ENABLED === "true" &&
    DEPLOYED_ID &&
    DEPLOYED_ID === PROGRAM_ID.toBase58()
);
export const base = new Connection(BASE_URL, "confirmed");
export const router = new ConnectionMagicRouter(ROUTER_URL, "confirmed");

export type ChainPhase =
  | "created"
  | "active"
  | "extracting"
  | "extracted"
  | "dead"
  | "timedOut";
export type ChainRun = {
  authority: PublicKey;
  index: BN;
  phase: Record<ChainPhase, object>;
  x: number;
  y: number;
  hp: number;
  deadline: BN;
  chestMask: number;
  pending: number[];
  nonce: BN;
  finalScore: number;
};
export type ChainProfile = { authority: PublicKey; nextRunIndex: BN };
export type RunSnapshot = {
  address: PublicKey;
  index: number;
  phase: ChainPhase;
  x: number;
  y: number;
  hp: number;
  deadline: number;
  chestMask: number;
  nonce: number;
  finalScore: number;
  source: "base" | "er";
  endpoint?: string;
  delegated: boolean;
};
export type GameSession = {
  signer: Keypair;
  token: PublicKey;
  expiresAt: number;
  authority: PublicKey;
};
const SESSION_TOP_UP_LAMPORTS = 2_000_000;
const SESSION_LIFETIME_SECONDS = 240;
export async function rpcDeadline<T>(
  operation: Promise<T>,
  milliseconds = 15000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("RPC response timed out; reconcile before retrying")
            ),
          milliseconds
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function transactionEvent(
  authority: PublicKey,
  signature: string,
  endpoint: string,
  stage: string
) {
  const detail = {
    authority: authority.toBase58(),
    signature,
    endpoint,
    stage,
  };
  console.info("loot:transaction", detail);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("loot:transaction", { detail }));
}

function provider(connection: Connection, wallet: AnchorWallet) {
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}
export function program(connection: Connection, wallet: AnchorWallet) {
  return new Program(idl as Idl, provider(connection, wallet));
}
function ensureConfigured() {
  if (!isConfigured)
    throw new Error(
      "Deploy and verify the session-aware program, then set NEXT_PUBLIC_GAME_V2_ENABLED=true before starting an onchain run."
    );
}
export function profileAddress(authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("profile"), authority.toBuffer()],
    PROGRAM_ID
  )[0];
}
export function runAddress(authority: PublicKey, index: number) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("run"),
      authority.toBuffer(),
      new BN(index).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  )[0];
}
export async function readAccount<T>(
  connection: Connection,
  wallet: AnchorWallet,
  address: PublicKey,
  name: string
): Promise<T | null> {
  const info = await rpcDeadline(
    connection.getAccountInfo(address, "confirmed")
  );
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  return program(connection, wallet).coder.accounts.decode(
    name,
    info.data
  ) as T;
}
export class PendingSubmission extends Error {
  constructor(
    public signature: string,
    public lastValidBlockHeight: number,
    public endpoint: string,
    cause: unknown
  ) {
    super(`Submission needs reconciliation: ${signature}`, { cause });
  }
}
const journalKey = (authority: PublicKey) =>
  `loot-or-lose:pending:${authority.toBase58()}`;
export function pendingSubmission(
  authority: PublicKey
): PendingSubmission | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(journalKey(authority));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      typeof value.signature !== "string" ||
      !Number.isSafeInteger(value.lastValidBlockHeight) ||
      typeof value.endpoint !== "string"
    )
      throw new Error("Invalid pending transaction record");
    // Do not allow browser storage to turn recovery into an arbitrary network request.
    const endpoint = new URL(value.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      !(
        endpoint.hostname === "magicblock.app" ||
        endpoint.hostname.endsWith(".magicblock.app")
      )
    )
      throw new Error("Invalid recovery endpoint");
    return new PendingSubmission(
      value.signature,
      value.lastValidBlockHeight,
      value.endpoint,
      "Recovered after reload"
    );
  } catch {
    throw new Error(
      "Pending transaction metadata is invalid; inspect it before clearing recovery state"
    );
  }
}
export function clearPendingSubmission(authority: PublicKey) {
  if (typeof window !== "undefined")
    window.localStorage.removeItem(journalKey(authority));
}
export async function submissionStatus(
  error: unknown
): Promise<"pending" | "applied" | "rejected"> {
  if (!(error instanceof PendingSubmission)) return "rejected";
  const connection = new Connection(error.endpoint, "confirmed");
  const status = (
    await rpcDeadline(
      connection.getSignatureStatuses([error.signature], {
        searchTransactionHistory: true,
      })
    )
  ).value[0];
  if (status?.err) return "rejected";
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  )
    return "applied";
  // A processed signature must not be treated as expired merely because the height advanced.
  if (status) return "pending";
  return (await rpcDeadline(connection.getBlockHeight("confirmed"))) >
    error.lastValidBlockHeight
    ? "rejected"
    : "pending";
}
async function sendSigned(
  connection: Connection,
  signed: Transaction,
  block: { blockhash: string; lastValidBlockHeight: number },
  authority: PublicKey
) {
  if (!signed.signature) throw new Error("Transaction was not signed");
  const signature = utils.bytes.bs58.encode(signed.signature);
  const previous = pendingSubmission(authority);
  if (previous && (await submissionStatus(previous)) === "pending")
    throw previous;
  if (typeof window !== "undefined")
    window.localStorage.setItem(
      journalKey(authority),
      JSON.stringify({
        signature,
        lastValidBlockHeight: block.lastValidBlockHeight,
        endpoint: connection.rpcEndpoint,
      })
    );
  try {
    transactionEvent(
      authority,
      signature,
      connection.rpcEndpoint,
      "submitting"
    );
    await rpcDeadline(
      connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      })
    );
    const result = await rpcDeadline(
      connection.confirmTransaction({ signature, ...block }, "confirmed")
    );
    if (result.value.err)
      throw new Error(
        `Confirmed transaction failed: ${JSON.stringify(result.value.err)}`
      );
    clearPendingSubmission(authority);
    transactionEvent(authority, signature, connection.rpcEndpoint, "confirmed");
    return signature;
  } catch (error) {
    throw new PendingSubmission(
      signature,
      block.lastValidBlockHeight,
      connection.rpcEndpoint,
      error
    );
  }
}
export async function submit(
  connection: Connection,
  wallet: AnchorWallet,
  transaction: Transaction,
  extraSigners: Keypair[] = [],
  guard: () => void = () => {}
): Promise<TransactionSignature> {
  transaction.feePayer = wallet.publicKey;
  const latest = await rpcDeadline(connection.getLatestBlockhash("confirmed"));
  transaction.recentBlockhash = latest.blockhash;
  const simulation = await rpcDeadline(
    connection.simulateTransaction(transaction)
  );
  if (simulation.value.err)
    throw new Error(
      `Preflight simulation failed: ${JSON.stringify(simulation.value.err)}`
    );
  if (extraSigners.length) transaction.partialSign(...extraSigners);
  guard();
  const signed = await wallet.signTransaction(transaction);
  guard();
  return sendSigned(connection, signed, latest, wallet.publicKey);
}
export async function submitSession(
  connection: Connection,
  session: GameSession,
  transaction: Transaction,
  guard: () => void = () => {}
): Promise<TransactionSignature> {
  if (Math.floor(Date.now() / 1000) >= session.expiresAt)
    throw new Error(
      "Game session expired. Authorize a new session to continue."
    );
  transaction.feePayer = session.signer.publicKey;
  const latest = await rpcDeadline(connection.getLatestBlockhash("confirmed"));
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(session.signer);
  const simulation = await rpcDeadline(
    connection.simulateTransaction(transaction)
  );
  if (simulation.value.err)
    throw new Error(
      `ER action simulation failed: ${JSON.stringify(simulation.value.err)}`
    );
  guard();
  return sendSigned(connection, transaction, latest, session.authority);
}
export async function createGameSession(
  wallet: AnchorWallet,
  guard: () => void = () => {}
): Promise<{ session: GameSession; signature: string }> {
  if (
    DEPLOYED_ID !== PROGRAM_ID.toBase58() ||
    !(isConfigured || process.env.NEXT_PUBLIC_WAGER_V3_ENABLED === "true")
  ) {
    throw new Error(
      "Deploy and verify the target game program before authorizing a session"
    );
  }
  const { SessionTokenManager } = await import("@magicblock-labs/gum-sdk");
  const manager = new SessionTokenManager(wallet, base);
  const signer = Keypair.generate();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const token = PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token_v2"),
      PROGRAM_ID.toBuffer(),
      signer.publicKey.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    manager.program.programId
  )[0];
  const transaction = await manager.program.methods
    .createSessionV2(true, new BN(expiresAt), new BN(SESSION_TOP_UP_LAMPORTS))
    .accounts({
      targetProgram: PROGRAM_ID,
      sessionSigner: signer.publicKey,
      feePayer: wallet.publicKey,
      authority: wallet.publicKey,
    })
    .transaction();
  const signature = await submit(base, wallet, transaction, [signer], guard);
  const info = await base.getAccountInfo(token, "confirmed");
  if (!info?.owner.equals(manager.program.programId))
    throw new Error(
      "Session creation confirmed, but the session token is not readable yet. Refresh before retrying."
    );
  return {
    session: { signer, token, expiresAt, authority: wallet.publicKey },
    signature,
  };
}
export async function revokeGameSession(
  wallet: AnchorWallet,
  token: PublicKey
): Promise<string> {
  const { SessionTokenManager } = await import("@magicblock-labs/gum-sdk");
  const manager = new SessionTokenManager(wallet, base);
  const transaction = await manager.program.methods
    .revokeSessionV2()
    .accounts({
      sessionToken: token,
      feePayer: wallet.publicKey,
      authority: wallet.publicKey,
    })
    .transaction();
  return submit(base, wallet, transaction);
}
export async function createRun(
  wallet: AnchorWallet
): Promise<{ index: number; address: PublicKey; signatures: string[] }> {
  ensureConfigured();
  const authority = wallet.publicKey;
  const profile = profileAddress(authority);
  const client = program(base, wallet);
  const signatures: string[] = [];
  const record = await readAccount<ChainProfile>(
    base,
    wallet,
    profile,
    "playerProfile"
  );
  if (!record) {
    const index = 0;
    const address = runAddress(authority, index);
    const transaction = new Transaction().add(
      await client.methods
        .initializeProfile()
        .accountsPartial({
          profile,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      await client.methods
        .createRun(new BN(index))
        .accountsPartial({
          profile,
          run: address,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
    signatures.push(await submit(base, wallet, transaction));
    return { index, address, signatures };
  }
  const index = record.nextRunIndex.toNumber();
  const address = runAddress(authority, index);
  signatures.push(
    await submit(
      base,
      wallet,
      await client.methods
        .createRun(new BN(index))
        .accountsPartial({
          profile,
          run: address,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .transaction()
    )
  );
  return { index, address, signatures };
}
export async function delegateRun(
  wallet: AnchorWallet,
  index: number
): Promise<string> {
  ensureConfigured();
  const client = program(base, wallet);
  const run = runAddress(wallet.publicKey, index);
  return submit(
    base,
    wallet,
    await client.methods
      .delegateRun(new BN(index))
      .accountsPartial({ authority: wallet.publicKey, run })
      .transaction()
  );
}
export async function resolveEr(
  address: PublicKey
): Promise<{ delegated: boolean; endpoint?: string; connection?: Connection }> {
  const status = (await rpcDeadline(router.getDelegationStatus(address))) as {
    isDelegated: boolean;
    fqdn?: string;
  };
  if (!status.isDelegated) return { delegated: false };
  if (!status.fqdn)
    throw new Error(
      "Router confirms delegation but has not returned an ER endpoint yet. Retry status shortly."
    );
  const endpoint = status.fqdn.startsWith("http")
    ? status.fqdn
    : `https://${status.fqdn}`;
  return {
    delegated: true,
    endpoint,
    connection: new Connection(endpoint, "confirmed"),
  };
}
export async function readRun(
  wallet: AnchorWallet,
  index: number
): Promise<RunSnapshot | null> {
  const address = runAddress(wallet.publicKey, index);
  const route = await resolveEr(address);
  const connection = route.connection || base;
  const state = await readAccount<ChainRun>(
    connection,
    wallet,
    address,
    "runState"
  );
  if (!state) return null;
  const phase = Object.keys(state.phase)[0] as ChainPhase;
  return {
    address,
    index,
    phase,
    x: state.x,
    y: state.y,
    hp: state.hp,
    deadline: state.deadline.toNumber(),
    chestMask: state.chestMask,
    nonce: state.nonce.toNumber(),
    finalScore: state.finalScore,
    source: route.delegated ? "er" : "base",
    endpoint: route.endpoint,
    delegated: route.delegated,
  };
}
export async function findLatestRun(
  wallet: AnchorWallet
): Promise<RunSnapshot | null> {
  const profile = await readAccount<ChainProfile>(
    base,
    wallet,
    profileAddress(wallet.publicKey),
    "playerProfile"
  );
  if (!profile || profile.nextRunIndex.isZero()) return null;
  return readRun(wallet, profile.nextRunIndex.subn(1).toNumber());
}
async function submitEr(
  wallet: AnchorWallet,
  index: number,
  build: (client: Program<Idl>, run: PublicKey) => Promise<Transaction>,
  session?: GameSession
): Promise<string> {
  const address = runAddress(wallet.publicKey, index);
  const route = await resolveEr(address);
  if (!route.connection)
    throw new Error("Run is not delegated to an Ephemeral Rollup.");
  const transaction = await build(program(route.connection, wallet), address);
  return session
    ? submitSession(route.connection, session, transaction)
    : submit(route.connection, wallet, transaction);
}
function actionAccounts(
  wallet: AnchorWallet,
  run: PublicKey,
  session?: GameSession
) {
  if (session && !session.authority.equals(wallet.publicKey))
    throw new Error("Session belongs to a different wallet.");
  return {
    run,
    sessionToken: session?.token || PROGRAM_ID,
    signer: session?.signer.publicKey || wallet.publicKey,
  };
}
export async function activateRun(
  wallet: AnchorWallet,
  index: number,
  session?: GameSession
) {
  return submitEr(
    wallet,
    index,
    (client, run) =>
      client.methods
        .activateRun(new BN(index))
        .accountsPartial(actionAccounts(wallet, run, session))
        .transaction(),
    session
  );
}
export async function advanceRun(
  wallet: AnchorWallet,
  state: RunSnapshot,
  path: number[],
  session: GameSession
) {
  return submitEr(
    wallet,
    state.index,
    (client, run) =>
      client.methods
        .advance(new BN(state.index), new BN(state.nonce), Buffer.from(path))
        .accountsPartial(actionAccounts(wallet, run, session))
        .transaction(),
    session
  );
}
export async function openChest(
  wallet: AnchorWallet,
  state: RunSnapshot,
  chestId: number,
  session: GameSession
) {
  return submitEr(
    wallet,
    state.index,
    (client, run) =>
      client.methods
        .openChest(new BN(state.index), new BN(state.nonce), chestId)
        .accountsPartial(actionAccounts(wallet, run, session))
        .transaction(),
    session
  );
}
export async function requestExtraction(
  wallet: AnchorWallet,
  state: RunSnapshot,
  session: GameSession
) {
  return submitEr(
    wallet,
    state.index,
    (client, run) =>
      client.methods
        .requestExtraction(new BN(state.index), new BN(state.nonce))
        .accountsPartial(actionAccounts(wallet, run, session))
        .transaction(),
    session
  );
}
export async function expireRun(wallet: AnchorWallet, index: number) {
  return submitEr(wallet, index, (client, run) =>
    client.methods
      .expireRun(new BN(index))
      .accountsPartial({ run })
      .transaction()
  );
}
export async function finalizeRun(
  wallet: AnchorWallet,
  index: number
): Promise<{ erSignature: string; commitSignature?: string }> {
  const address = runAddress(wallet.publicKey, index);
  const route = await resolveEr(address);
  if (!route.connection)
    throw new Error(
      "Run is not delegated. Read its base-layer receipt before retrying finalization."
    );
  const client = program(route.connection, wallet);
  const transaction = await client.methods
    .finalizeRun(new BN(index))
    .accountsPartial({ authority: wallet.publicKey, run: address })
    .transaction();
  const erSignature = await submit(route.connection, wallet, transaction);
  let commitSignature: string | undefined;
  try {
    commitSignature = await GetCommitmentSignature(
      erSignature,
      route.connection
    );
  } catch {
    /* Base read remains authoritative. */
  }
  return { erSignature, commitSignature };
}
export async function readBaseReceipt(
  wallet: AnchorWallet,
  index: number
): Promise<RunSnapshot | null> {
  const address = runAddress(wallet.publicKey, index);
  const state = await readAccount<ChainRun>(base, wallet, address, "runState");
  if (!state) return null;
  const phase = Object.keys(state.phase)[0] as ChainPhase;
  return {
    address,
    index,
    phase,
    x: state.x,
    y: state.y,
    hp: state.hp,
    deadline: state.deadline.toNumber(),
    chestMask: state.chestMask,
    nonce: state.nonce.toNumber(),
    finalScore: state.finalScore,
    source: "base",
    delegated: false,
  };
}
