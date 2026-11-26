import { test, expect, type Page } from "@playwright/test";
import {
  Program,
  BN,
  utils,
  BorshInstructionCoder,
  type Idl,
  type AnchorProvider,
} from "@coral-xyz/anchor";
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

async function fixture(page: Page, sessionControls = false) {
  // Disposable test-only wallet. All RPC is intercepted; no devnet transaction can be sent.
  const payer = Keypair.generate(),
    authority = payer.publicKey;
  const coder = new Program(
      idl as Idl,
      { connection: new Connection("http://localhost:8899") } as AnchorProvider,
    ).coder.accounts,
    pid = new PublicKey(idl.address);
  let sessionSigner = Keypair.generate().publicKey;
  let boundSigner = sessionSigner,
    sessionCreations = 0,
    sessionBindings = 0,
    rejectBinding = false,
    dropCreation = false;
  const sessionProgram = new PublicKey(
    "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
  );
  let token = PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token_v2"),
      pid.toBuffer(),
      sessionSigner.toBuffer(),
      authority.toBuffer(),
    ],
    sessionProgram,
  )[0];
  const { SessionTokenManager } = await import("@magicblock-labs/gum-sdk");
  const sessionCoder = new SessionTokenManager(
    { publicKey: authority } as never,
    new Connection("http://localhost:8899"),
  ).program.coder.accounts;
  let blocked = false,
    tokenClosed = false,
    nonceOffset = 0,
    failClosure = false;
  const instructionCoder = new BorshInstructionCoder(idl as Idl);
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
    if (
      rejectBinding &&
      tx.instructions.some(
        (ix) =>
          ix.programId.equals(pid) &&
          instructionCoder.decode(ix.data)?.name === "authorize_hunt_session",
      )
    )
      throw new Error("User rejected authorization");
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
            sessionSigner: sessionControls ? boundSigner : PublicKey.default,
            index: new BN(0),
            rulesVersion: 5,
            stake: new BN(200),
            phase: { [phase]: {} },
            x: 4,
            y: 1,
            questId: phase === "randomnessPending" ? 1 : 255,
            nonce: new BN(
              reveals.length * 2 +
                (phase === "randomnessPending" ? 1 : 0) +
                nonceOffset,
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
        if (
          key === token.toBase58() &&
          failClosure &&
          blocked &&
          !route.request().url().includes("devnet-as")
        )
          return route.abort("failed");
        if (key === token.toBase58() && sessionControls && !tokenClosed)
          value = {
            owner: sessionProgram.toBase58(),
            executable: false,
            lamports: 10000000,
            rentEpoch: 0,
            data: [
              (
                await sessionCoder.encode("sessionTokenV2", {
                  authority,
                  targetProgram: pid,
                  sessionSigner,
                  feePayer: authority,
                  validUntil: new BN(Math.floor(Date.now() / 1000) + 240),
                })
              ).toString("base64"),
              "base64",
            ],
          };
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
        if (sessionControls) {
          uploads++;
          const tx = Transaction.from(Buffer.from(rpc.params[0], "base64"));
          for (const ix of tx.instructions) {
            if (
              ix.programId.equals(pid) &&
              instructionCoder.decode(ix.data)?.name === "revoke_hunt_session"
            ) {
              blocked = true;
              boundSigner = PublicKey.default;
              nonceOffset++;
            }
            if (ix.programId.equals(pid)) {
              const decoded = instructionCoder.decode(ix.data);
              if (decoded?.name === "authorize_hunt_session") {
                boundSigner = (decoded.data as { session_signer: PublicKey })
                  .session_signer;
                sessionBindings++;
                blocked = false;
              }
            }
            if (ix.programId.equals(sessionProgram)) {
              if (tx.signatures.length > 1) {
                sessionSigner = tx.signatures.find(
                  (s) => !s.publicKey.equals(authority),
                )!.publicKey;
                token = PublicKey.findProgramAddressSync(
                  [
                    Buffer.from("session_token_v2"),
                    pid.toBuffer(),
                    sessionSigner.toBuffer(),
                    authority.toBuffer(),
                  ],
                  sessionProgram,
                )[0];
                tokenClosed = false;
                sessionCreations++;
              } else tokenClosed = true;
            }
          }
          applied = true;
          if (dropCreation && tx.signatures.length > 1) {
            dropCreation = false;
            return route.abort("failed");
          }
          result = utils.bytes.bs58.encode(tx.signature!);
          break;
        }
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
        result = sessionControls || pending ? 50 : 101;
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
    sessionState: () => ({ blocked, tokenClosed }),
    dropCreationResponse: () => {
      dropCreation = true;
    },
    sessionCounts: () => ({
      creations: sessionCreations,
      bindings: sessionBindings,
    }),
    rejectBinding: (value: boolean) => {
      rejectBinding = value;
    },
    failClosure: (value: boolean) => {
      failClosure = value;
    },
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
  ).toBeVisible({ timeout: 10000 }); // Allow the five-second subscription watchdog plus RPC/rendering.
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

test("session controls block the hunt key and close its base token", async ({
  page,
}) => {
  const f = await fixture(page, true);
  await f.connect();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Gameplay session" });
  await expect(dialog).toContainText("No usable key on this device");
  await dialog
    .getByRole("button", { name: "End gameplay session", exact: true })
    .click();
  await expect
    .poll(() => f.sessionState())
    .toEqual({ blocked: true, tokenClosed: true });
  await expect(page.locator(".quest-game")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(f.uploads()).toBe(2);
  await expect(dialog).toContainText("Not authorized");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Session", exact: true }),
  ).toBeFocused();
});

test("ending a session during pending randomness preserves the same request", async ({
  page,
}) => {
  const f = await fixture(page, true);
  f.delayRandomness();
  await f.connect();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Gameplay session" })
    .getByRole("button", { name: "End gameplay session", exact: true })
    .click();
  await expect
    .poll(() => f.sessionState())
    .toEqual({ blocked: true, tokenClosed: true });
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Demo amounts")).toContainText("1/3");
  expect(f.uploads()).toBe(2);
  f.resolveGate();
  await expect(
    page.getByRole("dialog", { name: "Loot frozen · collect to credit" }),
  ).toBeVisible({ timeout: 10000 });
  expect(f.uploads()).toBe(2);
});

test("reload completes token closure without repeating the hunt block", async ({
  page,
}) => {
  const f = await fixture(page, true);
  f.failClosure(true);
  await f.connect();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Gameplay session" })
    .getByRole("button", { name: "End gameplay session", exact: true })
    .click();
  await expect
    .poll(() => f.sessionState())
    .toEqual({ blocked: true, tokenClosed: false });
  await expect(
    page.getByRole("button", { name: "Recover existing attempt", exact: true }),
  ).toBeVisible();
  f.failClosure(false);
  await f.connect();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Gameplay session" });
  await expect(dialog).toContainText("needs recovery");
  await dialog
    .getByRole("button", { name: "End gameplay session", exact: true })
    .click();
  await expect
    .poll(() => f.sessionState())
    .toEqual({ blocked: true, tokenClosed: true });
  expect(f.uploads()).toBe(2);
});

for (const [width, height] of [
  [375, 667],
  [768, 900],
  [1280, 720],
  [844, 390],
]) {
  test(`session dialog and devnet toolbar fit ${width}×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const f = await fixture(page, true);
    await f.connect();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Session", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Gameplay session" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    await dialog
      .getByRole("button", { name: "End gameplay session", exact: true })
      .scrollIntoViewIfNeeded();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Session", exact: true }),
    ).toBeFocused();
  });
}

test("viewing public session expiry after reload does not enable a missing private key", async ({
  page,
}) => {
  const f = await fixture(page, true);
  await f.connect();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Gameplay session" });
  await expect(dialog).toContainText("No usable key on this device");
  await expect(dialog).not.toContainText("No active session");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Authorize gameplay session",
      exact: true,
    }),
  ).toBeVisible();
});

test("rejected ER authorization reuses the already funded in-memory session", async ({
  page,
}) => {
  const f = await fixture(page, true);
  f.rejectBinding(true);
  await f.connect();
  await page
    .getByRole("button", { name: "Authorize gameplay session", exact: true })
    .click();
  const recover = page.getByRole("button", {
    name: "Recover existing attempt",
    exact: true,
  });
  await expect(recover).toBeVisible();
  expect(f.sessionCounts()).toEqual({ creations: 1, bindings: 0 });
  await recover.click();
  await expect(recover).not.toBeVisible();
  f.rejectBinding(false);
  await page
    .getByRole("button", { name: "Authorize gameplay session", exact: true })
    .click();
  await expect
    .poll(() => f.sessionCounts())
    .toEqual({ creations: 1, bindings: 1 });
  await expect(page.locator(".quest-game")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(f.uploads()).toBe(2);
});

test("an uncertain session-creation response recovers the same funded key", async ({
  page,
}) => {
  const f = await fixture(page, true);
  f.dropCreationResponse();
  await f.connect();
  await page
    .getByRole("button", { name: "Authorize gameplay session", exact: true })
    .click();
  const recover = page.getByRole("button", {
    name: "Recover existing attempt",
    exact: true,
  });
  await expect(recover).toBeVisible();
  expect(f.sessionCounts()).toEqual({ creations: 1, bindings: 0 });
  await recover.click();
  await expect(recover).not.toBeVisible();
  await page
    .getByRole("button", { name: "Authorize gameplay session", exact: true })
    .click();
  await expect
    .poll(() => f.sessionCounts())
    .toEqual({ creations: 1, bindings: 1 });
  await expect(page.locator(".quest-game")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(f.uploads()).toBe(2);
});
