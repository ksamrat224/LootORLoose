import { test, expect } from "@playwright/test";
import { BN, BorshInstructionCoder } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  type AccountInfo,
} from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { base, program, PROGRAM_ID, submit } from "../src/lib/chain";
import {
  buildHuntPreparation,
  decodeHuntAccount,
  type Wager,
} from "../src/lib/hunt-chain";
import { watchHunt, type HuntWatchTransport } from "../src/lib/hunt-watch";

const wallet: AnchorWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async () => {
    throw new Error("must not sign during planning");
  },
  signAllTransactions: async () => {
    throw new Error("must not sign during planning");
  },
};

test("fresh preparation fits one packet and authorizes before delegating", async () => {
  const original = base.getAccountInfo;
  const flag = process.env.NEXT_PUBLIC_HUNT_V5_ENABLED,
    network = process.env.NEXT_PUBLIC_NETWORK,
    pid = process.env.NEXT_PUBLIC_GAME_PROGRAM_ID;
  // chain.DEPLOYED_ID is evaluated on import, so this test's command sets public configuration.
  process.env.NEXT_PUBLIC_NETWORK = "devnet";
  base.getAccountInfo = async () => null;
  try {
    const result = await buildHuntPreparation(wallet, 200);
    expect(result.session.expiresAt - Date.now() / 1000).toBeGreaterThan(235);
    expect(
      result.combined.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).length,
    ).toBeLessThanOrEqual(1232);
    const coder = program(base, wallet).coder
      .instruction as BorshInstructionCoder;
    const names = result.combined.instructions
      .filter((ix) => ix.programId.equals(PROGRAM_ID))
      .map((ix) => coder.decode(ix.data)?.name);
    expect(names).toEqual([
      "initializeHuntHouse",
      "initializeHuntPlayer",
      "createHuntAttempt",
      "authorizeHuntSession",
      "delegateHuntAttempt",
    ]);
    const create = coder.decode(
      result.combined.instructions.find(
        (ix) => coder.decode(ix.data)?.name === "createHuntAttempt",
      )!.data,
    );
    expect((create!.data as { stake: BN }).stake.toNumber()).toBe(200);
    expect(result.combined.compileMessage().header.numRequiredSignatures).toBe(
      2,
    );
  } finally {
    base.getAccountInfo = original;
    if (flag !== undefined) process.env.NEXT_PUBLIC_HUNT_V5_ENABLED = flag;
    if (network === undefined) delete process.env.NEXT_PUBLIC_NETWORK;
    else process.env.NEXT_PUBLIC_NETWORK = network;
    if (pid !== undefined) process.env.NEXT_PUBLIC_GAME_PROGRAM_ID = pid;
  }
});

async function fixture(version = 5) {
  let nonce = 0,
    route = 0,
    gets = 0,
    removed = 0;
  const callbacks: ((
    info: AccountInfo<Buffer>,
    context: { slot: number },
  ) => void)[] = [];
  const info = async (n = nonce) => ({
    owner: PROGRAM_ID,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
    data: await program(base, wallet).coder.accounts.encode("huntAttempt", {
      authority: wallet.publicKey,
      sessionSigner: PublicKey.default,
      index: new BN(0),
      rulesVersion: version,
      stake: new BN(200),
      phase: { active: {} },
      x: 1,
      y: 1,
      questId: 255,
      nonce: new BN(n),
      requestNonce: new BN(0),
      requestedAt: new BN(0),
      fulfilledAt: new BN(0),
      openedMask: 0,
      revealCount: 0,
      reveals: Array.from({ length: 3 }, () => ({
        questId: 255,
        randomness: Array(32).fill(0),
        bucket: 0,
        reward: new BN(0),
      })),
      payout: new BN(0),
      bump: 255,
    }),
  });
  const connections = [0, 1].map((i) =>
    Object.assign(new Connection(`http://localhost:${8899 + i}`), {
      onAccountChange: (_key: PublicKey, cb: (typeof callbacks)[number]) => {
        callbacks.push(cb);
        return callbacks.length;
      },
      removeAccountChangeListener: async () => {
        removed++;
      },
      getAccountInfo: async () => {
        gets++;
        return info();
      },
    }),
  );
  const transport: HuntWatchTransport = {
    route: async () => ({
      delegated: true,
      endpoint: connections[route].rpcEndpoint,
      connection: connections[route],
    }),
    base: connections[0],
    read: async () => {
      throw new Error("base ledger must not be read for delegated reveals");
    },
    decode: decodeHuntAccount,
  };
  return {
    transport,
    callbacks,
    info,
    setNonce: (n: number) => {
      nonce = n;
    },
    changeRoute: () => {
      route = 1;
    },
    counts: () => ({ gets, removed }),
  };
}

test("ER pushes update immediately, reject stale nonces and clean up", async () => {
  const f = await fixture();
  const seen: Wager[] = [];
  const stop = watchHunt(
    wallet,
    0,
    (v) => seen.push(v),
    () => {},
    f.transport,
  );
  try {
    await expect.poll(() => seen.length).toBe(1);
    f.callbacks[0](await f.info(2), { slot: 12 });
    expect(seen.at(-1)?.nonce).toBe(2);
    expect(f.counts().gets).toBe(1);
    f.callbacks[0](await f.info(1), { slot: 13 });
    expect(seen.at(-1)?.nonce).toBe(2);
    const wrongOwner = { ...(await f.info(3)), owner: PublicKey.default };
    f.callbacks[0](wrongOwner, { slot: 14 });
    expect(seen.at(-1)?.nonce).toBe(2);
  } finally {
    stop();
  }
  const length = seen.length;
  f.callbacks[0](await f.info(4), { slot: 15 });
  expect(seen).toHaveLength(length);
  expect(f.counts().removed).toBe(1);
});

test("watchdog finds missed updates, follows routing and ignores the old endpoint", async () => {
  const f = await fixture();
  const seen: Wager[] = [];
  const stop = watchHunt(
    wallet,
    0,
    (v) => seen.push(v),
    () => {},
    f.transport,
  );
  try {
    await expect.poll(() => seen.length).toBe(1);
    f.setNonce(2);
    f.changeRoute();
    await expect.poll(() => seen.at(-1)?.nonce, { timeout: 8000 }).toBe(2);
    expect(f.callbacks).toHaveLength(2);
    f.callbacks[0](await f.info(99), { slot: 99 });
    expect(seen.at(-1)?.nonce).toBe(2);
    f.callbacks[1](await f.info(4), { slot: 20 });
    expect(seen.at(-1)?.nonce).toBe(4);
  } finally {
    stop();
  }
});

test("unavailable subscriptions use serialized fallback reads", async () => {
  const f = await fixture();
  const seen: Wager[] = [];
  f.transport.base.onAccountChange = () => {
    throw new Error("WebSocket unavailable");
  };
  const stop = watchHunt(
    wallet,
    0,
    (v) => seen.push(v),
    () => {},
    f.transport,
  );
  try {
    await expect.poll(() => seen.length).toBe(1);
    f.setNonce(2);
    await expect.poll(() => seen.at(-1)?.nonce, { timeout: 4000 }).toBe(2);
  } finally {
    stop();
  }
});

test("preflight and wallet rejection never upload a preparation", async () => {
  const connection = new Connection("http://localhost:8899");
  let signatures = 0,
    uploads = 0;
  connection.getLatestBlockhash = async () => ({
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 100,
  });
  connection.simulateTransaction = async () =>
    ({
      value: { err: { InstructionError: [1, "ComputationalBudgetExceeded"] } },
    } as never);
  connection.sendRawTransaction = async () => {
    uploads++;
    return "unexpected";
  };
  const original = base.getAccountInfo;
  base.getAccountInfo = async () => null;
  try {
    const { combined, session } = await buildHuntPreparation(wallet, 200);
    const rejecting = {
      ...wallet,
      signTransaction: async () => {
        signatures++;
        throw new Error("User rejected");
      },
    };
    await expect(
      submit(connection, rejecting, combined, [session.signer]),
    ).rejects.toThrow("Preflight simulation failed");
    expect(signatures).toBe(0);
    connection.simulateTransaction = async () =>
      ({ value: { err: null } } as never);
    await expect(
      submit(connection, rejecting, combined, [session.signer]),
    ).rejects.toThrow("User rejected");
    expect(signatures).toBe(1);
    expect(uploads).toBe(0);
  } finally {
    base.getAccountInfo = original;
  }
});

test("account decoding recovers V6 independently of the creation flag and rejects unknown rules", async () => {
  for (const version of [5, 6, 7]) {
    const f = await fixture(version);
    const info = await f.info();
    if (version === 7)
      expect(() =>
        decodeHuntAccount(wallet, 0, info, { delegated: true }),
      ).toThrow();
    else
      expect(
        decodeHuntAccount(wallet, 0, info, { delegated: true }).rulesVersion,
      ).toBe(version);
  }
});
