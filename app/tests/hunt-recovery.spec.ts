import { test, expect, type Page } from "@playwright/test";
import { Program, BN, type Idl, type AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import idl from "../src/lib/loot_or_lose.json";
import { pda } from "../src/lib/hunt-chain";

async function connectWallet(page: Page) {
  if (await page.getByRole("button", { name: /Select Wallet/ }).count()) {
    await page.getByRole("button", { name: /Select Wallet/ }).click();
    await page.getByRole("button", { name: /Fixture Wallet/ }).click();
  }
  const connect = page.getByRole("button", { name: /Connect$/ });
  if (await connect.count()) await connect.click();
}

async function fixture(page: Page) {
  // Disposable test-only wallet. All RPC is intercepted; no devnet transaction can be sent.
  const payer = Keypair.generate(),
    authority = payer.publicKey;
  const coder = new Program(
      idl as Idl,
      { connection: new Connection("http://localhost:8899") } as AnchorProvider,
    ).coder.accounts,
    pid = new PublicKey(idl.address);
  let legacyActive = 0;
  let phase = "active",
    reveals: {
      questId: number;
      randomness: number[];
      bucket: number;
      reward: BN;
    }[] = [],
    pending = false,
    applied = false,
    outage = false,
    uploads = 0;
  const encode = async (name: string, value: object) => ({
    data: [(await coder.encode(name, value)).toString("base64"), "base64"],
    owner: pid.toBase58(),
    executable: false,
    lamports: 10000000,
    rentEpoch: 0,
    space: 256,
  });
  const playerKey = pda("hunt_player_v5", authority).toBase58();
  const wagerKey = pda("hunt_attempt_v5", authority, 0).toBase58();
  await page.exposeFunction("testWalletSign", (bytes: number[]) => {
    const tx = Transaction.from(Buffer.from(bytes));
    tx.partialSign(payer);
    return Array.from(tx.serialize({ requireAllSignatures: false }));
  });
  await page.addInitScript(
    ({ address, bytes }) => {
      const account = {
        address,
        publicKey: new Uint8Array(bytes),
        chains: ["solana:devnet"],
        features: ["solana:signTransaction"],
      };
      const listeners = new Set<(value: object) => void>();
      const state = window as unknown as {
        testReject?: boolean;
        testPauseSign?: boolean;
        testSigning?: boolean;
        testReleaseSign?: () => void;
        testChange?: () => void;
        testWalletSign: (value: number[]) => Promise<number[]>;
      };
      const wallet = {
        version: "1.0.0",
        name: "Fixture Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        chains: ["solana:devnet"],
        accounts: [] as (typeof account)[],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              wallet.accounts = [account];
              return { accounts: wallet.accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              wallet.accounts = [];
              listeners.forEach((fn) => fn({ accounts: [] }));
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event: string, fn: (value: object) => void) => {
              listeners.add(fn);
              return () => listeners.delete(fn);
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (
              ...inputs: { transaction: Uint8Array }[]
            ) => {
              if (state.testPauseSign) {
                state.testSigning = true;
                await new Promise<void>((resolve) => {
                  state.testReleaseSign = resolve;
                });
              }
              if (state.testReject)
                throw new Error("User rejected the request");
              return Promise.all(
                inputs.map(async (input) => ({
                  signedTransaction: new Uint8Array(
                    await state.testWalletSign(Array.from(input.transaction)),
                  ),
                })),
              );
            },
          },
        },
      };
      state.testChange = () => {
        wallet.accounts = [];
        listeners.forEach((fn) => fn({ accounts: [] }));
      };
      window.addEventListener("wallet-standard:app-ready", ((
        event: CustomEvent,
      ) => event.detail.register(wallet)) as EventListener);
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: (api: { register: (value: object) => void }) =>
            api.register(wallet),
        }),
      );
    },
    { address: authority.toBase58(), bytes: Array.from(authority.toBytes()) },
  );
  await page.route(/https:\/\/[^/]*magicblock\.app\//, async (route) => {
    if (outage) return route.abort("failed");
    const rpc = route.request().postDataJSON();
    let result: unknown = null;
    switch (rpc.method) {
      case "getDelegationStatus":
        result = {
          isDelegated: true,
          fqdn: "https://devnet-as.magicblock.app",
        };
        break;
      case "getAccountInfo": {
        const key = rpc.params[0];
        let value: unknown = null;
        if (key === playerKey)
          value = await encode("huntPlayer", {
            authority,
            balance: new BN(9800),
            nextIndex: new BN(1),
            active: true,
            activeIndex: new BN(0),
            bump: 255,
          });
        if (key === wagerKey && route.request().url().includes("devnet-as"))
          value = await encode("huntAttempt", {
            authority,
            sessionSigner: PublicKey.default,
            index: new BN(0),
            rulesVersion: 5,
            stake: new BN(200),
            phase: { [phase]: {} },
            x: 4,
            y: 1,
            questId: phase === "randomnessPending" ? 1 : 255,
            nonce: new BN(
              reveals.length * 2 + (phase === "randomnessPending" ? 1 : 0),
            ),
            requestNonce: new BN(
              reveals.length * 2 + (phase === "randomnessPending" ? 1 : 0),
            ),
            requestedAt: new BN(
              phase === "randomnessPending"
                ? Math.floor(Date.now() / 1000) - 120
                : reveals.length
                  ? 1
                  : 0,
            ),
            fulfilledAt: new BN(reveals.length ? 3 : 0),
            openedMask: reveals.reduce((m, r) => m | (1 << r.questId), 0),
            revealCount: reveals.length,
            reveals: [
              ...reveals,
              ...Array.from({ length: 3 - reveals.length }, () => ({
                questId: 0,
                randomness: Array(32).fill(0),
                bucket: 0,
                reward: new BN(0),
              })),
            ],
            payout: new BN(
              phase === "cancelled"
                ? 200
                : reveals.reduce((sum, r) => sum + r.reward.toNumber(), 0),
            ),
            bump: 255,
          });
        if (key === pda("hunt_ticket_v5", authority, 0).toBase58())
          value = await encode("huntTicket", {
            authority,
            index: new BN(0),
            stake: new BN(200),
            questId: 255,
            reserve: new BN(999),
            settled: false,
            payout: new BN(0),
            bump: 255,
          });
        if (
          key === pda("demo_player_v3", authority).toBase58() &&
          legacyActive === 3
        )
          value = await encode("demoPlayer", {
            authority,
            balance: new BN(9800),
            nextIndex: new BN(1),
            active: true,
            activeIndex: new BN(0),
            bump: 255,
          });
        if (
          key === pda("quest_player_v4", authority).toBase58() &&
          legacyActive === 4
        )
          value = await encode("questPlayer", {
            authority,
            balance: new BN(9800),
            nextIndex: new BN(1),
            active: true,
            activeIndex: new BN(0),
            bump: 255,
          });
        result = { context: { slot: 1 }, value };
        break;
      }
      case "getLatestBlockhash":
        result = {
          context: { slot: 1 },
          value: {
            blockhash: Keypair.generate().publicKey.toBase58(),
            lastValidBlockHeight: 100,
          },
        };
        break;
      case "simulateTransaction":
        result = {
          context: { slot: 1 },
          value: { err: null, logs: [], unitsConsumed: 1000 },
        };
        break;
      case "sendTransaction":
        uploads++;
        pending = true;
        return route.abort("failed");
      case "getSignatureStatuses":
        result = {
          context: { slot: 1 },
          value: [
            applied
              ? {
                  slot: 1,
                  confirmations: 1,
                  err: null,
                  confirmationStatus: "confirmed",
                }
              : null,
          ],
        };
        break;
      case "getBlockHeight":
        result = pending ? 50 : 101;
        break;
      default:
        throw new Error(`Unexpected mocked RPC ${rpc.method}`);
    }
    await route.fulfill({ json: { jsonrpc: "2.0", id: rpc.id, result } });
  });
  const connect = async () => {
    await page.goto("http://localhost:3102");
    await page.getByRole("button", { name: "Play", exact: true }).click();

    await page.getByRole("radio", { name: "Devnet", exact: true }).check();
    await connectWallet(page);
    await expect(
      page.getByLabel("Demo amounts").getByText("$98.00", { exact: true }),
    ).toBeVisible();
  };
  return {
    connect,
    uploads: () => uploads,
    blockWithV3: () => {
      legacyActive = 3;
    },
    blockWithV4: () => {
      legacyActive = 4;
    },
    delayRandomness: () => {
      reveals = [
        {
          questId: 0,
          randomness: [40, ...Array(31).fill(0)],
          bucket: 40,
          reward: new BN(50),
        },
      ];
      phase = "randomnessPending";
    },
    resolveGate: () => {
      phase = "complete";
      reveals = [0, 40, 99].map((bucket, questId) => ({
        questId,
        randomness: [bucket, ...Array(31).fill(0)],
        bucket,
        reward: new BN([0, 50, 333][questId]),
      }));
    },
    apply: () => {
      applied = true;
      phase = "cancelled";
    },
    outage: (value: boolean) => {
      outage = value;
    },
  };
}

test("V5 reload restores the same attempt and disconnect clears its state", async ({
  page,
}) => {
  const game = await fixture(page);
  await game.connect();
  await expect(
    page.getByRole("button", { name: "Authorize gameplay session" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();

  await page.getByRole("radio", { name: "Devnet", exact: true }).check();
  await connectWallet(page);
  await expect(
    page.getByLabel("Demo amounts").getByText("$98.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Fixture Wallet icon/ }).click();
  await page.getByText("Disconnect", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Authorize gameplay session" }),
  ).toHaveCount(0);
  expect(game.uploads()).toBe(0);
});
test("V5 delayed VRF fallback preserves the unresolved request", async ({
  page,
}) => {
  const game = await fixture(page);
  await game.connect();
  game.delayRandomness();
  await expect(
    page.getByText("The service is delayed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel hunt · full refund" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Switch to practice", exact: true })
    .click();
  await page.getByRole("radio", { name: "Devnet", exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Check existing request" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Demo amounts").getByText("$98.00", { exact: true }),
  ).toBeVisible();
  expect(game.uploads()).toBe(0);
});
test("V5 ambiguous cancellation survives reload without resending", async ({
  page,
}) => {
  const game = await fixture(page);
  await game.connect();
  await page.getByRole("button", { name: "Cancel hunt · full refund" }).click();
  await expect(
    page.getByRole("button", { name: "Recover existing attempt" }),
  ).toBeVisible();
  expect(game.uploads()).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Play", exact: true }).click();

  await page.getByRole("radio", { name: "Devnet", exact: true }).check();
  await connectWallet(page);
  await page.getByRole("button", { name: "Recover existing attempt" }).click();
  await expect(
    page.getByText("The same transaction is still pending.", { exact: false }),
  ).toBeVisible();
  game.apply();
  await page.getByRole("button", { name: "Recover existing attempt" }).click();
  await expect(
    page.getByRole("button", { name: "Collect refund", exact: true }),
  ).toBeVisible();
  expect(game.uploads()).toBe(1);
});
test("V5 rejected approval and outage keep the existing attempt", async ({
  page,
}) => {
  const game = await fixture(page);
  await game.connect();
  await page.evaluate(() => {
    (window as unknown as { testReject: boolean }).testReject = true;
  });
  await page.getByRole("button", { name: "Cancel hunt · full refund" }).click();
  await expect(
    page.getByRole("button", { name: "Recover existing attempt" }),
  ).toBeVisible();
  game.outage(true);
  await page.getByRole("button", { name: "Recover existing attempt" }).click();
  await expect(
    page.getByText("Recovery could not reach devnet.", { exact: false }),
  ).toBeVisible();
  game.outage(false);
  await page.getByRole("button", { name: "Recover existing attempt" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel hunt · full refund" }),
  ).toBeEnabled();
  expect(game.uploads()).toBe(0);
});
test("V5 proof recomputes all three rewards and their sum", async ({
  page,
}) => {
  const game = await fixture(page);
  await game.connect();
  game.resolveGate();
  await page
    .getByRole("dialog", { name: "Loot frozen · collect to credit" })
    .getByRole("button", { name: "Proof of roll", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Verify all reveals in your browser" })
    .click();
  await expect(
    page.getByText("Match · all reveal rewards", { exact: false }),
  ).toBeVisible();
  expect(game.uploads()).toBe(0);
});
test("an unresolved V3 run blocks V5 preparation", async ({ page }) => {
  const game = await fixture(page);
  game.blockWithV3();
  await page.goto("http://localhost:3102");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("radio", { name: "Devnet", exact: true }).check();
  await connectWallet(page);
  await expect(
    page.getByRole("link", { name: "Recover V3 run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose stake", exact: true }),
  ).toHaveCount(0);
  expect(game.uploads()).toBe(0);
});

test("an unresolved V4 quest directs V5 players to its recovery route", async ({
  page,
}) => {
  const game = await fixture(page);
  game.blockWithV4();
  await page.goto("http://localhost:3102");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("radio", { name: "Devnet", exact: true }).check();
  await connectWallet(page);
  await expect(
    page.getByRole("link", { name: "Recover V4 run", exact: true }),
  ).toHaveAttribute("href", "/recovery/quests");
  expect(game.uploads()).toBe(0);
});
test("V5 disconnect during approval prevents the old wallet submission", async ({
  page,
}) => {
  const game = await fixture(page);
  await game.connect();
  await page.evaluate(() => {
    (window as unknown as { testPauseSign: boolean }).testPauseSign = true;
  });
  await page.getByRole("button", { name: "Cancel hunt · full refund" }).click();
  await page.waitForFunction(
    () => (window as unknown as { testSigning: boolean }).testSigning,
  );
  await page.getByRole("button", { name: /Fixture Wallet icon/ }).click();
  await page.getByText("Disconnect", { exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { testReleaseSign: () => void }).testReleaseSign(),
  );
  await expect(
    page.getByRole("button", { name: "Choose stake", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel hunt · full refund" }),
  ).toHaveCount(0);
  expect(game.uploads()).toBe(0);
});
