import { supportedHuntRules } from "../game/hunt-rules";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
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
  buildGameSession,
  revokeGameSession,
  rpcDeadline,
  type GameSession,
} from "./chain";

export const huntV6Enabled = process.env.NEXT_PUBLIC_HUNT_V6_ENABLED === "true";
export const newDevnetHuntRules = () => (huntV6Enabled ? 6 : 5);
export const huntEnabled = process.env.NEXT_PUBLIC_HUNT_V5_ENABLED === "true";
export const huntSessionControlEnabled =
  process.env.NEXT_PUBLIC_HUNT_SESSION_CONTROL_ENABLED === "true";
export type WagerPhase =
  | "active"
  | "randomnessPending"
  | "complete"
  | "cancelled";
type ChainWager = {
  authority: PublicKey;
  sessionSigner: PublicKey;
  index: BN;
  rulesVersion: number;
  stake: BN;
  phase: Record<WagerPhase, object>;
  x: number;
  y: number;
  questId: number;
  nonce: BN;
  requestNonce: BN;
  requestedAt: BN;
  fulfilledAt: BN;
  openedMask: number;
  revealCount: number;
  reveals: {
    questId: number;
    randomness: number[];
    bucket: number;
    reward: BN;
  }[];
  payout: BN;
};
export type Wager = {
  sessionSigner?: PublicKey;
  /** Practice-only draws, never sent to the program or presented as VRF. */
  practiceBuckets?: number[];
  address: PublicKey;
  index: number;
  rulesVersion: number;
  stake: number;
  phase: WagerPhase;
  x: number;
  y: number;
  questId: number;
  nonce: number;
  requestNonce: number;
  requestedAt: number;
  fulfilledAt?: number;
  payout: number;
  delegated: boolean;
  endpoint?: string;
  settled: boolean;
  openedMask: number;
  revealCount: number;
  reveals: {
    questId: number;
    randomness: number[];
    bucket: number;
    reward: number;
  }[];
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
    PROGRAM_ID,
  )[0];
export const houseAddress = () => pda("hunt_house_v5");
export const playerAddress = (authority: PublicKey) =>
  pda("hunt_player_v5", authority);
export const wagerAddress = (authority: PublicKey, index: number) =>
  pda("hunt_attempt_v5", authority, index);
export const ticketAddress = (authority: PublicKey, index: number) =>
  pda("hunt_ticket_v5", authority, index);
export const readPlayer = (wallet: AnchorWallet) =>
  readAccount<Player>(
    base,
    wallet,
    playerAddress(wallet.publicKey),
    "huntPlayer",
  );
export const readHouse = (wallet: AnchorWallet) =>
  readAccount<House>(base, wallet, houseAddress(), "huntHouse");
export const terminal = (wager: Wager) =>
  ["complete", "cancelled"].includes(wager.phase);
function ensureEnabled() {
  if (!huntEnabled)
    throw new Error("Wager mode is awaiting verified deployment");
  if (process.env.NEXT_PUBLIC_NETWORK !== "devnet")
    throw new Error("Demo wagering is restricted to devnet");
  if (DEPLOYED_ID !== PROGRAM_ID.toBase58())
    throw new Error("Configured wager program does not match the deployed IDL");
}

export async function initializeLedger(
  wallet: AnchorWallet,
  guard: () => void = () => {},
) {
  ensureEnabled();
  const tx = new Transaction(),
    client = program(base, wallet),
    authority = wallet.publicKey;
  if (!(await readHouse(wallet)))
    tx.add(
      await client.methods
        .initializeHuntHouse()
        .accountsPartial({
          house: houseAddress(),
          authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  if (!(await readPlayer(wallet)))
    tx.add(
      await client.methods
        .initializeHuntPlayer()
        .accountsPartial({
          player: playerAddress(authority),
          authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  if (tx.instructions.length) await submit(base, wallet, tx, [], guard);
}
export async function readWager(
  wallet: AnchorWallet,
  index: number,
  baseOnly = false,
  runtimeOnly = false,
): Promise<Wager | null> {
  const address = wagerAddress(wallet.publicKey, index);
  const route = baseOnly
    ? { delegated: false, connection: undefined, endpoint: undefined }
    : await resolveEr(address);
  const value = await readAccount<ChainWager>(
    route.connection || base,
    wallet,
    address,
    "huntAttempt",
  );
  if (!value) return null;
  // Movement and pending-gate polling need only the authoritative runtime.
  // Settlement checks still read the independent base-layer ticket.
  const ticket = runtimeOnly
    ? null
    : await readAccount<{ settled: boolean; payout: BN }>(
        base,
        wallet,
        ticketAddress(wallet.publicKey, index),
        "huntTicket",
      );
  return decodeHunt(wallet, index, value, route, !!ticket?.settled);
}
function decodeHunt(
  wallet: AnchorWallet,
  index: number,
  value: ChainWager,
  route: { delegated: boolean; endpoint?: string },
  settled = false,
): Wager {
  if (
    !value.authority.equals(wallet.publicKey) ||
    value.index.toNumber() !== index ||
    !supportedHuntRules(value.rulesVersion)
  )
    throw new Error(
      "Hunt account does not match the requested wallet and index",
    );
  return {
    sessionSigner: value.sessionSigner,
    address: wagerAddress(wallet.publicKey, index),
    index,
    rulesVersion: value.rulesVersion,
    stake: value.stake.toNumber(),
    phase: Object.keys(value.phase)[0] as WagerPhase,
    x: value.x,
    y: value.y,
    questId: value.questId,
    nonce: value.nonce.toNumber(),
    requestNonce: value.requestNonce.toNumber(),
    requestedAt: value.requestedAt.toNumber(),
    fulfilledAt: value.fulfilledAt.toNumber(),
    payout: value.payout.toNumber(),
    delegated: route.delegated,
    endpoint: route.endpoint,
    settled,
    openedMask: value.openedMask,
    revealCount: value.revealCount,
    reveals: value.reveals
      .slice(0, value.revealCount)
      .map((r) => ({ ...r, reward: r.reward.toNumber() })),
  };
}
export async function createWager(
  wallet: AnchorWallet,
  stake: number,
  guard: () => void = () => {},
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
      .methods[huntV6Enabled ? "createHuntAttemptV6" : "createHuntAttempt"](
        new BN(index),
        new BN(stake),
      )
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
    guard,
  );
  return index;
}
export async function delegateWager(
  wallet: AnchorWallet,
  index: number,
  guard: () => void = () => {},
) {
  ensureEnabled();
  return submit(
    base,
    wallet,
    await program(base, wallet)
      .methods.delegateHuntAttempt(new BN(index))
      .accountsPartial({
        authority: wallet.publicKey,
        wager: wagerAddress(wallet.publicKey, index),
      })
      .transaction(),
    [],
    guard,
  );
}
export async function waitForEr(
  wallet: AnchorWallet,
  index: number,
): Promise<Connection> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const route = await resolveEr(wagerAddress(wallet.publicKey, index));
    if (route.connection && (await readWager(wallet, index)))
      return route.connection;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "Delegation is still propagating. Recover this run before starting another.",
  );
}
// A token observed in a particular ER need not be fetched before every move.
// On-chain session constraints continue to validate expiry and revocation.
const propagatedSessions = new WeakMap<GameSession, Set<string>>();
export async function wagerAction(
  wallet: AnchorWallet,
  state: Wager,
  session: GameSession,
  kind: "risk",
  questId: number,
  approachPath: number[],
  guard: () => void = () => {},
) {
  ensureEnabled();
  if (!session.authority.equals(wallet.publicKey))
    throw new Error("Session belongs to a different wallet");
  const route = await resolveEr(state.address);
  if (!route.connection) throw new Error("Waiting for the delegated run");
  const endpoint = route.connection.rpcEndpoint;
  const observed = propagatedSessions.get(session) || new Set<string>();
  // The session token must be available in the actual ER runtime, not just on base.
  for (let attempt = 0; !observed.has(endpoint) && attempt < 10; attempt++) {
    if (await route.connection.getAccountInfo(session.token)) {
      observed.add(endpoint);
      propagatedSessions.set(session, observed);
      break;
    }
    if (attempt === 9)
      throw new Error("Session is still propagating. Retry after a moment.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const client = program(route.connection, wallet);
  console.info("loot:wager-action", {
    index: state.index,
    run: state.address.toBase58(),
    nonce: state.nonce,
    questId: state.questId,
    kind,
    endpoint: route.endpoint,
  });
  const method = client.methods.riskHunt(
    new BN(state.index),
    new BN(state.nonce),
    questId,
    Buffer.from(approachPath),
  );
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
            "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
          ),
        }
      : {};
  return submitSession(
    route.connection,
    session,
    await method.accountsPartial({ ...accounts, ...extra }).transaction(),
    guard,
  );
}
export async function cancelWager(
  wallet: AnchorWallet,
  state: Wager,
  guard: () => void = () => {},
) {
  const route = await resolveEr(state.address);
  return submit(
    route.connection || base,
    wallet,
    await program(route.connection || base, wallet)
      .methods.cancelHuntAttempt(new BN(state.index))
      .accountsPartial({ wager: state.address, authority: wallet.publicKey })
      .transaction(),
    [],
    guard,
  );
}
export async function authorizeWagerSession(
  wallet: AnchorWallet,
  state: Wager,
  session: GameSession,
  guard: () => void = () => {},
) {
  const route = await resolveEr(state.address);
  return submit(
    route.connection || base,
    wallet,
    await program(route.connection || base, wallet)
      .methods.authorizeHuntSession(
        new BN(state.index),
        session.signer.publicKey,
      )
      .accountsPartial({ wager: state.address, authority: wallet.publicKey })
      .transaction(),
    [],
    guard,
  );
}
export async function settleWager(
  wallet: AnchorWallet,
  state: Wager,
  progress: (message: string) => void,
  guard: () => void = () => {},
) {
  ensureEnabled();
  if (!terminal(state))
    throw new Error("All three quests must finish before collection");
  if (state.settled) return;
  const route = await resolveEr(state.address);
  if (route.connection) {
    progress("Confirm result with your wallet…");
    await submit(
      route.connection,
      wallet,
      await program(route.connection, wallet)
        .methods.finalizeHuntAttempt(new BN(state.index))
        .accountsPartial({ wager: state.address, authority: wallet.publicKey })
        .transaction(),
      [],
      guard,
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
      "Settlement is still pending. Recover this run to continue.",
    );
  if (receipt.settled) return;
  progress("Credit the confirmed result with your wallet…");
  const authority = wallet.publicKey;
  await submit(
    base,
    wallet,
    await program(base, wallet)
      .methods.settleHuntAttempt(new BN(state.index))
      .accountsPartial({
        house: houseAddress(),
        player: playerAddress(authority),
        ticket: ticketAddress(authority, state.index),
        wager: state.address,
        authority,
      })
      .transaction(),
    [],
    guard,
  );
  const verified = await readWager(wallet, state.index, true);
  if (!verified?.settled || !(await readPlayer(wallet)))
    throw new Error(
      "Balance credit is not confirmed yet. Recover before retrying.",
    );
}

export type HuntSessionRecord = {
  authority: string;
  index: number;
  signer: string;
  token: string;
  expiresAt: number;
  ending?: boolean;
};
const sessionKey = (authority: PublicKey, index: number) =>
  `loot:hunt-session:${authority.toBase58()}:${index}`;
export function rememberHuntSession(
  wallet: AnchorWallet,
  index: number,
  session: GameSession,
) {
  const record: HuntSessionRecord = {
    authority: wallet.publicKey.toBase58(),
    index,
    signer: session.signer.publicKey.toBase58(),
    token: session.token.toBase58(),
    expiresAt: session.expiresAt,
  };
  if (typeof window !== "undefined")
    localStorage.setItem(
      sessionKey(wallet.publicKey, index),
      JSON.stringify(record),
    );
  return record;
}
export function savedHuntSession(
  wallet: AnchorWallet,
  index: number,
): HuntSessionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(sessionKey(wallet.publicKey, index)) || "null",
    );
    if (
      value?.authority !== wallet.publicKey.toBase58() ||
      value.index !== index
    )
      return null;
    new PublicKey(value.signer);
    new PublicKey(value.token);
    return value;
  } catch {
    return null;
  }
}
export async function huntSessionRecord(
  wallet: AnchorWallet,
  state: Wager,
): Promise<HuntSessionRecord | null> {
  const saved = savedHuntSession(wallet, state.index);
  const signer =
    state.sessionSigner && !state.sessionSigner.equals(PublicKey.default)
      ? state.sessionSigner
      : saved
      ? new PublicKey(saved.signer)
      : null;
  if (!signer) return null;
  const { SessionTokenManager } = await import("@magicblock-labs/gum-sdk");
  const manager = new SessionTokenManager(wallet, base);
  const token = PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token_v2"),
      PROGRAM_ID.toBuffer(),
      signer.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    manager.program.programId,
  )[0];
  if (
    saved &&
    saved.signer === signer.toBase58() &&
    saved.token !== token.toBase58()
  )
    throw new Error("Saved session token does not match its signer");
  const info = await rpcDeadline(base.getAccountInfo(token, "confirmed"));
  const data = info?.owner.equals(manager.program.programId)
    ? manager.program.coder.accounts.decode("sessionTokenV2", info.data)
    : null;
  return {
    authority: wallet.publicKey.toBase58(),
    index: state.index,
    signer: signer.toBase58(),
    token: token.toBase58(),
    expiresAt: data?.validUntil.toNumber() ?? saved?.expiresAt ?? 0,
    ending: saved?.signer === signer.toBase58() && saved.ending,
  };
}

/** One explicit hunt, one session; delegation must be the last instruction. */
export async function buildHuntPreparation(
  wallet: AnchorWallet,
  stake: number,
  guard: () => void = () => {},
) {
  ensureEnabled();
  const [player, house] = await Promise.all([
    readPlayer(wallet),
    readHouse(wallet),
  ]);
  guard();
  if (player?.active)
    throw new Error("An existing hunt needs recovery before preparing another");
  const index = player?.nextIndex.toNumber() ?? 0;
  const authority = wallet.publicKey,
    wager = wagerAddress(authority, index),
    client = program(base, wallet);
  const setup = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
  );
  const common = { authority, systemProgram: SystemProgram.programId };
  if (!house)
    setup.add(
      await client.methods
        .initializeHuntHouse()
        .accountsPartial({ ...common, house: houseAddress() })
        .instruction(),
    );
  if (!player)
    setup.add(
      await client.methods
        .initializeHuntPlayer()
        .accountsPartial({ ...common, player: playerAddress(authority) })
        .instruction(),
    );
  setup.add(
    await client.methods[
      huntV6Enabled ? "createHuntAttemptV6" : "createHuntAttempt"
    ](new BN(index), new BN(stake))
      .accountsPartial({
        ...common,
        house: houseAddress(),
        player: playerAddress(authority),
        ticket: ticketAddress(authority, index),
        wager,
      })
      .instruction(),
  );
  const built = await buildGameSession(wallet);
  setup.add(...built.transaction.instructions);
  setup.add(
    await client.methods
      .authorizeHuntSession(new BN(index), built.session.signer.publicKey)
      .accountsPartial({ wager, authority })
      .instruction(),
  );
  const delegation = await client.methods
    .delegateHuntAttempt(new BN(index))
    .accountsPartial({ wager, authority })
    .instruction();
  const combined = new Transaction().add(...setup.instructions, delegation);
  combined.feePayer = authority;
  combined.recentBlockhash = PublicKey.default.toBase58();
  return { index, session: built.session, setup, delegation, combined };
}

export async function prepareHunt(
  wallet: AnchorWallet,
  stake: number,
  progress: (message: string) => void,
  guard: () => void = () => {},
  retainSession: (session: GameSession) => void = () => {},
) {
  const { index, session, setup, delegation, combined } =
    await buildHuntPreparation(wallet, stake, guard);
  const built = { session };
  let split = false;
  try {
    combined.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
  } catch (error) {
    if (!String(error).includes("Transaction too large")) throw error;
    split = true;
  }
  rememberHuntSession(wallet, index, built.session);
  guard();
  retainSession(built.session);
  if (!split) {
    progress(
      "Preparation · approval 1/1 · reserve stake, fund session and delegate",
    );
    try {
      await submit(base, wallet, combined, [built.session.signer], guard);
    } catch (error) {
      // Only an unsent, deterministic simulation resource failure can select the split path.
      if (
        !/^Error: Preflight simulation failed:.*(ComputationalBudgetExceeded)/.test(
          String(error),
        )
      )
        throw error;
      split = true;
    }
  }
  if (split) {
    progress(
      "Preparation · approval 1/2 · reserve stake and authorize session",
    );
    await submit(base, wallet, setup, [built.session.signer], guard);
    guard();
    progress("Preparation · approval 2/2 · delegate this hunt");
    await submit(base, wallet, new Transaction().add(delegation), [], guard);
  }
  guard();
  progress("Waiting for dungeon and session propagation…");
  await waitForEr(wallet, index);
  guard();
  return { index, session: built.session };
}

/** First removes ER application permission; base token closure is a separate confirmed effect. */
export async function endHuntSession(
  wallet: AnchorWallet,
  state: Wager,
  progress: (message: string) => void,
  guard: () => void = () => {},
) {
  if (!huntSessionControlEnabled)
    throw new Error("Session controls await verified deployment");
  const record = await huntSessionRecord(wallet, state);
  guard();
  if (record && typeof window !== "undefined")
    localStorage.setItem(
      sessionKey(wallet.publicKey, state.index),
      JSON.stringify({ ...record, ending: true }),
    );
  const current = await readWager(wallet, state.index);
  if (!current) throw new Error("Recover the hunt before ending its session");
  if (
    current.sessionSigner &&
    !current.sessionSigner.equals(PublicKey.default)
  ) {
    const route = await resolveEr(current.address);
    progress("Approval 1/2 · block the session key on this hunt");
    await submit(
      route.connection || base,
      wallet,
      await program(route.connection || base, wallet)
        .methods.revokeHuntSession(new BN(state.index))
        .accountsPartial({ wager: state.address, authority: wallet.publicKey })
        .transaction(),
      [],
      guard,
    );
    guard();
    const blocked = await readWager(wallet, state.index);
    if (!blocked?.sessionSigner?.equals(PublicKey.default))
      throw new Error(
        "Hunt session removal is not confirmed. Recover before continuing",
      );
  }
  progress("Hunt key blocked. Approval 2/2 · close its Solana session token");
  if (record) {
    const token = new PublicKey(record.token);
    if (await rpcDeadline(base.getAccountInfo(token, "confirmed"))) {
      guard();
      await revokeGameSession(wallet, token);
      guard();
      if (await rpcDeadline(base.getAccountInfo(token, "confirmed")))
        throw new Error("Hunt key blocked; token closure still needs recovery");
    }
  }
  if (typeof window !== "undefined")
    localStorage.removeItem(sessionKey(wallet.publicKey, state.index));
  progress(
    "Hunt key blocked and Solana token closed. Accepted reveals still finish normally.",
  );
}

export function decodeHuntAccount(
  wallet: AnchorWallet,
  index: number,
  info: { owner: PublicKey; data: Buffer },
  route: { delegated: boolean; endpoint?: string },
): Wager {
  if (!info.owner.equals(PROGRAM_ID))
    throw new Error("Unexpected hunt account owner");
  return decodeHunt(
    wallet,
    index,
    program(base, wallet).coder.accounts.decode(
      "huntAttempt",
      info.data,
    ) as ChainWager,
    route,
  );
}
