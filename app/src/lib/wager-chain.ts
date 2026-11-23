import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  base,
  DEPLOYED_ID,
  program,
  PROGRAM_ID,
  readAccount,
  resolveEr,
  submit,
  submitSession,
  type GameSession,
} from "./chain";

export const wagerEnabled = process.env.NEXT_PUBLIC_WAGER_V3_ENABLED === "true";
export type WagerPhase =
  | "active"
  | "randomnessPending"
  | "extracting"
  | "lost"
  | "cancelled";
type ChainWager = {
  authority: PublicKey;
  index: BN;
  rulesVersion: number;
  stake: BN;
  phase: Record<WagerPhase, object>;
  x: number;
  y: number;
  gate: number;
  nonce: BN;
  requestNonce: BN;
  requestedAt: BN;
  fulfilledAt: BN;
  randomness: number[];
  payout: BN;
};
export type Wager = {
  address: PublicKey;
  index: number;
  rulesVersion: number;
  stake: number;
  phase: WagerPhase;
  x: number;
  y: number;
  gate: number;
  nonce: number;
  requestNonce: number;
  requestedAt: number;
  payout: number;
  delegated: boolean;
  endpoint?: string;
  settled: boolean;
  randomness: number[];
};
export type Player = {
  authority: PublicKey;
  balance: BN;
  nextIndex: BN;
  active: boolean;
  activeIndex: BN;
};
export type House = { balance: BN; reserved: BN };
export const pda = (seed: string, authority?: PublicKey, index?: number) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from(seed),
      ...(authority ? [authority.toBuffer()] : []),
      ...(index !== undefined
        ? [new BN(index).toArrayLike(Buffer, "le", 8)]
        : []),
    ],
    PROGRAM_ID
  )[0];
export const houseAddress = () => pda("demo_house_v3");
export const playerAddress = (authority: PublicKey) =>
  pda("demo_player_v3", authority);
export const wagerAddress = (authority: PublicKey, index: number) =>
  pda("wager_v3", authority, index);
export const ticketAddress = (authority: PublicKey, index: number) =>
  pda("ticket_v3", authority, index);
export const readPlayer = (wallet: AnchorWallet) =>
  readAccount<Player>(
    base,
    wallet,
    playerAddress(wallet.publicKey),
    "demoPlayer"
  );
export const readHouse = (wallet: AnchorWallet) =>
  readAccount<House>(base, wallet, houseAddress(), "demoHouse");
export const terminal = (wager: Wager) =>
  ["extracting", "lost", "cancelled"].includes(wager.phase);
function ensureEnabled() {
  if (!wagerEnabled)
    throw new Error("Wager mode is awaiting verified deployment");
  if (process.env.NEXT_PUBLIC_NETWORK !== "devnet")
    throw new Error("Demo wagering is restricted to devnet");
  if (DEPLOYED_ID !== PROGRAM_ID.toBase58())
    throw new Error("Configured wager program does not match the deployed IDL");
}

export async function initializeLedger(
  wallet: AnchorWallet,
  guard: () => void = () => {}
) {
  ensureEnabled();
  const tx = new Transaction(),
    client = program(base, wallet),
    authority = wallet.publicKey;
  if (!(await readHouse(wallet)))
    tx.add(
      await client.methods
        .initializeHouse()
        .accountsPartial({
          house: houseAddress(),
          authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
  if (!(await readPlayer(wallet)))
    tx.add(
      await client.methods
        .initializeDemoPlayer()
        .accountsPartial({
          player: playerAddress(authority),
          authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
  if (tx.instructions.length) await submit(base, wallet, tx, [], guard);
}
export async function readWager(
  wallet: AnchorWallet,
  index: number,
  baseOnly = false
): Promise<Wager | null> {
  const address = wagerAddress(wallet.publicKey, index);
  const route = baseOnly
    ? { delegated: false, connection: undefined, endpoint: undefined }
    : await resolveEr(address);
  const value = await readAccount<ChainWager>(
    route.connection || base,
    wallet,
    address,
    "wagerState"
  );
  if (!value) return null;
  const ticket = await readAccount<{ settled: boolean; payout: BN }>(
    base,
    wallet,
    ticketAddress(wallet.publicKey, index),
    "wagerTicket"
  );
  return {
    address,
    index,
    rulesVersion: value.rulesVersion,
    stake: value.stake.toNumber(),
    phase: Object.keys(value.phase)[0] as WagerPhase,
    x: value.x,
    y: value.y,
    gate: value.gate,
    nonce: value.nonce.toNumber(),
    requestNonce: value.requestNonce.toNumber(),
    requestedAt: value.requestedAt.toNumber(),
    payout: value.payout.toNumber(),
    delegated: route.delegated,
    endpoint: route.endpoint,
    settled: !!ticket?.settled,
    randomness: value.randomness,
  };
}
export async function createWager(
  wallet: AnchorWallet,
  stake: number,
  guard: () => void = () => {}
): Promise<number> {
  ensureEnabled();
  const player = await readPlayer(wallet);
  if (!player) throw new Error("Initialize the demo ledger first");
  if (player.active) return player.activeIndex.toNumber();
  const index = player.nextIndex.toNumber(),
    authority = wallet.publicKey;
  await submit(
    base,
    wallet,
    await program(base, wallet)
      .methods.createWager(new BN(index), new BN(stake))
      .accountsPartial({
        house: houseAddress(),
        player: playerAddress(authority),
        ticket: ticketAddress(authority, index),
        wager: wagerAddress(authority, index),
        authority,
        systemProgram: SystemProgram.programId,
      })
      .transaction(),
    [],
    guard
  );
  return index;
}
export async function delegateWager(
  wallet: AnchorWallet,
  index: number,
  guard: () => void = () => {}
) {
  ensureEnabled();
  return submit(
    base,
    wallet,
    await program(base, wallet)
      .methods.delegateWager(new BN(index))
      .accountsPartial({
        authority: wallet.publicKey,
        wager: wagerAddress(wallet.publicKey, index),
      })
      .transaction(),
    [],
    guard
  );
}
export async function waitForEr(
  wallet: AnchorWallet,
  index: number
): Promise<Connection> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const route = await resolveEr(wagerAddress(wallet.publicKey, index));
    if (route.connection && (await readWager(wallet, index)))
      return route.connection;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "Delegation is still propagating. Recover this run before starting another."
  );
}
export async function wagerAction(
  wallet: AnchorWallet,
  state: Wager,
  session: GameSession,
  kind: "advance" | "risk" | "extract",
  path: number[] = [],
  guard: () => void = () => {}
) {
  ensureEnabled();
  if (!session.authority.equals(wallet.publicKey))
    throw new Error("Session belongs to a different wallet");
  const route = await resolveEr(state.address);
  if (!route.connection) throw new Error("Waiting for the delegated run");
  // The session token must be available in the actual ER runtime, not just on base.
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await route.connection.getAccountInfo(session.token)) break;
    if (attempt === 9)
      throw new Error("Session is still propagating. Retry after a moment.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const client = program(route.connection, wallet);
  console.info("loot:wager-action", {
    index: state.index,
    run: state.address.toBase58(),
    nonce: state.nonce,
    gate: state.gate,
    kind,
    endpoint: route.endpoint,
  });
  const method =
    kind === "advance"
      ? client.methods.advanceWager(
          new BN(state.index),
          new BN(state.nonce),
          Buffer.from(path)
        )
      : kind === "risk"
      ? client.methods.riskGate(new BN(state.index), new BN(state.nonce))
      : client.methods.extractWager(new BN(state.index), new BN(state.nonce));
  const accounts = {
    wager: state.address,
    sessionToken: session.token,
    signer: session.signer.publicKey,
  };
  // Official SDK queue for requests executed inside an ER.
  const extra =
    kind === "risk"
      ? {
          oracleQueue: new PublicKey(
            "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
          ),
        }
      : {};
  return submitSession(
    route.connection,
    session,
    await method.accountsPartial({ ...accounts, ...extra }).transaction(),
    guard
  );
}
export async function cancelWager(
  wallet: AnchorWallet,
  state: Wager,
  guard: () => void = () => {}
) {
  const route = await resolveEr(state.address);
  return submit(
    route.connection || base,
    wallet,
    await program(route.connection || base, wallet)
      .methods.cancelWager(new BN(state.index))
      .accountsPartial({ wager: state.address, authority: wallet.publicKey })
      .transaction(),
    [],
    guard
  );
}
export async function authorizeWagerSession(
  wallet: AnchorWallet,
  state: Wager,
  session: GameSession,
  guard: () => void = () => {}
) {
  const route = await resolveEr(state.address);
  return submit(
    route.connection || base,
    wallet,
    await program(route.connection || base, wallet)
      .methods.authorizeWagerSession(
        new BN(state.index),
        session.signer.publicKey
      )
      .accountsPartial({ wager: state.address, authority: wallet.publicKey })
      .transaction(),
    [],
    guard
  );
}
export async function settleWager(
  wallet: AnchorWallet,
  state: Wager,
  progress: (message: string) => void,
  guard: () => void = () => {}
) {
  ensureEnabled();
  if (!terminal(state))
    throw new Error("A risk gate must finish before settlement");
  if (state.settled) return;
  const route = await resolveEr(state.address);
  if (route.connection) {
    progress("Confirm result with your wallet…");
    await submit(
      route.connection,
      wallet,
      await program(route.connection, wallet)
        .methods.finalizeWager(new BN(state.index))
        .accountsPartial({ wager: state.address, authority: wallet.publicKey })
        .transaction(),
      [],
      guard
    );
  }
  progress("Waiting for the Solana receipt…");
  let receipt: Wager | null = null;
  for (let attempt = 0; attempt < 45; attempt++) {
    guard();
    receipt = await readWager(wallet, state.index, true);
    if (receipt && terminal(receipt)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!receipt || !terminal(receipt))
    throw new Error(
      "Settlement is still pending. Recover this run to continue."
    );
  if (receipt.settled) return;
  progress("Credit the confirmed result with your wallet…");
  const authority = wallet.publicKey;
  await submit(
    base,
    wallet,
    await program(base, wallet)
      .methods.settleWager(new BN(state.index))
      .accountsPartial({
        house: houseAddress(),
        player: playerAddress(authority),
        ticket: ticketAddress(authority, state.index),
        wager: state.address,
        authority,
      })
      .transaction(),
    [],
    guard
  );
  const verified = await readWager(wallet, state.index, true);
  if (!verified?.settled || !(await readPlayer(wallet)))
    throw new Error(
      "Balance credit is not confirmed yet. Recover before retrying."
    );
}
