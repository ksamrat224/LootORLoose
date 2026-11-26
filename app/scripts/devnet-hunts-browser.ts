/** Real devnet RPC + fresh Wallet Standard signer; --interrupt drops selected real RPC responses. */
import { chromium, expect, type Page } from "@playwright/test";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  base,
  PROGRAM_ID,
  submit,
  createGameSession,
  program,
} from "../src/lib/chain";
import {
  readPlayer,
  readWager,
  readHouse,
  terminal,
  cancelWager,
  settleWager,
  authorizeWagerSession,
  wagerAction,
} from "../src/lib/hunt-chain";
import { verifyHunt } from "../src/game/HuntProof";
import { QUESTS, approachPath } from "../src/game/hunt-rules";

const moves = ["Move up", "Move right", "Move down", "Move left"];
async function connect(page: Page) {
  if (await page.getByRole("button", { name: /Select Wallet/ }).count()) {
    await page.getByRole("button", { name: /Select Wallet/ }).click();
    await page.getByRole("button", { name: /Live Devnet Wallet/ }).click();
  }
  const button = page.getByRole("button", { name: /Connect$/ });
  if (await button.count()) await button.click();
}
async function waitForSettlement(page: Page, title: string, action: string) {
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    if (
      await page.getByRole("dialog", { name: title, exact: true }).isVisible()
    )
      return;
    const recover = page.getByRole("button", {
      name: "Recover existing attempt",
      exact: true,
    });
    if ((await recover.isVisible()) && (await recover.isEnabled())) {
      console.log("BROWSER_RECOVERY_CHECK");
      await page.keyboard.press("Escape");
      await recover.click();
    } else if (
      (await page.locator(".quest-game").getAttribute("aria-busy")) === "false"
    ) {
      const dialog = page.getByRole("dialog");
      if (await dialog.isVisible()) {
        const retry = dialog.getByRole("button", { name: action, exact: true });
        if ((await retry.isVisible()) && (await retry.isEnabled()))
          await retry.click();
      } else {
        const view = page.getByRole("button", {
          name: "View result",
          exact: true,
        });
        if (await view.isVisible()) {
          await view.click();
          continue;
        }
        const result = page.getByRole("button", { name: action, exact: true });
        if ((await result.isVisible()) && (await result.isEnabled()))
          await result.click();
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Settlement did not reach ${title}; preserve its existing transaction identity`,
  );
}
async function main() {
  if (!process.argv.includes("--send"))
    throw new Error(
      "Use --send to authorize a 0.05 devnet SOL fresh-wallet funding transfer and live browser transactions",
    );
  if (process.env.NEXT_PUBLIC_NETWORK !== "devnet")
    throw new Error("Devnet only");
  const url = new URL(process.env.LIVE_HUNT_URL || "http://localhost:3230");
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Browser signer is restricted to the local app");
  const deployed = await base.getAccountInfo(PROGRAM_ID);
  if (
    !deployed?.executable ||
    deployed.data.length !== 36 ||
    deployed.data.readUInt32LE(0) !== 2
  )
    throw new Error("Expected upgradeable program");
  const data = await base.getAccountInfo(
    new PublicKey(deployed.data.subarray(4, 36)),
  );
  const binary = readFileSync(
    new URL("../../target/deploy/loot_or_lose.so", import.meta.url),
  );
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  if (
    !data ||
    !data.owner.equals(deployed.owner) ||
    hash(data.data.subarray(45, 45 + binary.length)) !== hash(binary)
  )
    throw new Error("Deployed binary does not match; no funding sent");
  const path =
    process.env.SOLANA_KEYPAIR ||
    execFileSync("solana", ["config", "get"], { encoding: "utf8" })
      .match(/^Keypair Path:\s*(.+)$/m)?.[1]
      ?.trim();
  if (!path) throw new Error("No configured fee payer");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
  const walletFor = (key: Keypair) => ({
    publicKey: key.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> => {
      if (tx instanceof Transaction) tx.partialSign(key);
      else tx.sign([key]);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ) =>
      Promise.all(
        txs.map(async (tx) => {
          if (tx instanceof Transaction) tx.partialSign(key);
          else tx.sign([key]);
          return tx;
        }),
      ),
  });
  // A public run tag makes test-wallet recovery possible without storing another secret.
  const walletTag = process.env.LIVE_HUNT_WALLET_TAG || randomUUID();
  console.log("BROWSER_WALLET_TAG", walletTag);
  const fresh = Keypair.fromSeed(
      createHmac("sha256", payer.secretKey)
        .update(`loot-or-lose:devnet-browser:v1:${walletTag}`)
        .digest(),
    ),
    wallet = walletFor(fresh),
    authority = fresh.publicKey;
  if (await readPlayer(wallet)) throw new Error("Expected a fresh V5 ledger");
  console.log(
    "FRESH_BROWSER_WALLET",
    authority.toBase58(),
    "Funding: 0.05 devnet SOL; original payer:",
    payer.publicKey.toBase58(),
  );
  const sessionProgram = new SessionTokenManager(wallet, base).program
    .programId;
  const allowed = new Set([
    PROGRAM_ID.toBase58(),
    sessionProgram.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
  ]);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.setDefaultTimeout(120_000);
  let signatures = 0;
  let bindingRejected = false;
  const walletCoder = program(base, wallet).coder
    .instruction as BorshInstructionCoder;
  await page.exposeFunction("liveWalletSign", (bytes: number[]) => {
    const tx = Transaction.from(Buffer.from(bytes));
    if (
      !tx.feePayer?.equals(authority) ||
      tx.instructions.some((ix) => !allowed.has(ix.programId.toBase58())) ||
      signatures >= 24
    )
      throw new Error("Browser transaction exceeds the authorized game scope");
    signatures++;
    console.log(
      "BROWSER_APPROVAL",
      signatures,
      tx.instructions.map((ix) => ix.programId.toBase58()),
    );
    const names = tx.instructions
      .filter((ix) => ix.programId.equals(PROGRAM_ID))
      .map((ix) => walletCoder.decode(ix.data)?.name);
    if (
      process.argv.includes("--reject-binding") &&
      !bindingRejected &&
      names.includes("authorizeHuntSession") &&
      !names.includes("createHuntAttempt") &&
      !names.includes("createHuntAttemptV6")
    ) {
      bindingRejected = true;
      console.log("CONTROLLED_APPROVAL_REJECTION", "authorizeHuntSession");
      throw new Error("User rejected the test session binding");
    }
    tx.partialSign(fresh);
    return Array.from(tx.serialize({ requireAllSignatures: false }));
  });
  // tsx preserves function names with this helper; serialized page callbacks need it locally.
  await page.addInitScript("globalThis.__name = (fn) => fn;");
  await page.addInitScript(
    ({ address, bytes }) => {
      const account = {
        address,
        publicKey: new Uint8Array(bytes),
        chains: ["solana:devnet"],
        features: ["solana:signTransaction"],
      };
      const listeners = new Set<(value: object) => void>();
      const bridge = window as unknown as {
        liveWalletSign: (value: number[]) => Promise<number[]>;
      };
      const wallet = {
        version: "1.0.0",
        name: "Live Devnet Wallet",
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
            signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
              Promise.all(
                inputs.map(async (input) => ({
                  signedTransaction: new Uint8Array(
                    await bridge.liveWalletSign(Array.from(input.transaction)),
                  ),
                })),
              ),
          },
        },
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
  page.on("console", (message) => {
    if (
      message.text().includes("loot:transaction") ||
      message.text().includes("loot:hunt-update")
    )
      console.log("BROWSER_EVENT", message.text());
  });
  page.on("pageerror", (error) => console.log("BROWSER_ERROR", error.message));
  const interrupted = new Set<string>();
  if (process.argv.includes("--interrupt")) {
    const coder = program(base, wallet).coder
      .instruction as BorshInstructionCoder;
    await page.route(/https:\/\/[^/]*magicblock\.app\//, async (route) => {
      const rpc = route.request().postDataJSON();
      if (rpc?.method === "sendTransaction") {
        const tx = Transaction.from(Buffer.from(rpc.params[0], "base64"));
        const names = tx.instructions
          .filter((ix) => ix.programId.equals(PROGRAM_ID))
          .map((ix) => coder.decode(ix.data)?.name);
        const target = ["riskHunt", "settleHuntAttempt"].find(
          (name) => names.includes(name) && !interrupted.has(name),
        );
        if (target) {
          interrupted.add(target);
          const response = await route.fetch(); // Actual transaction reaches devnet; discard only its response.
          console.log(
            "CONTROLLED_CONNECTION_INTERRUPTION",
            target,
            response.status(),
          );
          return route.abort("failed");
        }
      }
      return route.continue();
    });
  }
  const recoverInterrupted = async () => {
    const recover = page.getByRole("button", {
      name: "Recover existing attempt",
      exact: true,
    });
    if (await recover.isVisible()) {
      await page.keyboard.press("Escape");
      if (await recover.isEnabled()) {
        await recover.click();
        await expect(page.locator(".quest-game")).toHaveAttribute(
          "aria-busy",
          "false",
          { timeout: 120_000 },
        );
      }
    }
  };
  const snapshot = async () => {
    const p = await readPlayer(wallet);
    if (!p?.active) throw new Error("Expected active hunt");
    const value = await readWager(wallet, p.activeIndex.toNumber());
    if (!value) throw new Error("Expected readable hunt");
    return value;
  };
  try {
    await page.goto(url.toString());
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("radio", { name: "Devnet", exact: true }).check();
    await connect(page);
    const funding = await submit(
      base,
      walletFor(payer),
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: authority,
          lamports: 50_000_000,
        }),
      ),
    );
    console.log("FUNDING_SIGNATURE", funding);
    await page
      .getByRole("button", { name: "Choose stake", exact: true })
      .click();
    await page.getByRole("button", { name: "Start hunt", exact: true }).click();
    await page.getByRole("button", { name: "Explore", exact: true }).waitFor();
    console.log(
      "BROWSER_PREPARATION_COMPLETE",
      "wallet approvals:",
      signatures,
    );
    if (signatures !== 1)
      throw new Error("Fresh preparation did not use one wallet approval");
    for (const [step, id] of [5, 3, 4].entries()) {
      const current = await snapshot();
      if (current.phase !== "active" || current.revealCount !== step)
        throw new Error("Unexpected reveal progression");
      for (const direction of approachPath(QUESTS[id], {
        x: current.x,
        y: current.y,
      }))
        await page
          .getByRole("button", { name: moves[direction], exact: true })
          .click();
      await page
        .getByRole("button", { name: "Open quest", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: `Open · ${QUESTS[id].name}` })
        .getByRole("button", { name: "Open quest", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: step === 2 ? "Loot frozen · collect to credit" : "Quest revealed",
      });
      const revealDeadline = Date.now() + 180_000;
      while (Date.now() < revealDeadline) {
        await recoverInterrupted();
        if (await dialog.isVisible()) break;
        const currentState = await snapshot();
        if (currentState.revealCount === step + 1) {
          // Recovery may have dismissed a reveal dialog; reopen only the existing UI result.
          if (step === 2)
            await page
              .getByRole("button", { name: "Collect loot", exact: true })
              .click();
          else break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (step === 2) await dialog.waitFor({ timeout: 30_000 });
      const resolved = await snapshot();
      if (resolved.revealCount !== step + 1 || !(await verifyHunt(resolved)))
        throw new Error("Browser reveal proof mismatch");
      console.log(
        "BROWSER_REVEAL",
        JSON.stringify({
          questId: id,
          count: resolved.revealCount,
          payout: resolved.payout,
          address: resolved.address.toBase58(),
        }),
      );
      if (step < 2 && (await dialog.isVisible()))
        await dialog
          .getByRole("button", { name: "Continue hunt", exact: true })
          .click();
      if (step === 0) {
        await page
          .getByRole("button", { name: "Session", exact: true })
          .click();
        const sessionDialog = page.getByRole("dialog", {
          name: "Gameplay session",
        });
        await sessionDialog
          .getByRole("button", { name: "End gameplay session", exact: true })
          .click();
        await expect(page.locator(".quest-game")).toHaveAttribute(
          "aria-busy",
          "false",
          { timeout: 120_000 },
        );
        const blocked = await snapshot();
        if (!blocked.sessionSigner?.equals(PublicKey.default))
          throw new Error("UI did not remove hunt session authority");
        console.log("BROWSER_SESSION_END_VERIFIED");
        await page.reload();
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await page.getByRole("radio", { name: "Devnet", exact: true }).check();
        await connect(page);
        await expect(page.getByLabel("Demo amounts")).toContainText("1/3");
        const restored = page.getByRole("dialog", { name: "Quest revealed" });
        await restored.waitFor({ timeout: 5000 }).catch(() => {});
        if (await restored.isVisible())
          await restored.getByRole("button", { name: "Continue hunt" }).click();
        await page
          .getByRole("button", {
            name: "Authorize gameplay session",
            exact: true,
          })
          .click();
        await expect(page.locator(".quest-game")).toHaveAttribute(
          "aria-busy",
          "false",
          { timeout: 120_000 },
        );
        if (process.argv.includes("--reject-binding")) {
          if (!bindingRejected)
            throw new Error("Expected the session-binding rejection");
          const beforeRetry: number = signatures;
          await recoverInterrupted();
          await page
            .getByRole("button", {
              name: "Authorize gameplay session",
              exact: true,
            })
            .click();
          await expect(page.locator(".quest-game")).toHaveAttribute(
            "aria-busy",
            "false",
            { timeout: 120_000 },
          );
          if (signatures !== beforeRetry + 1)
            throw new Error(
              "Session retry funded another key instead of reusing it",
            );
          console.log("FUNDED_SESSION_REUSED_AFTER_REJECTION");
        }
        console.log("BROWSER_RELOAD_RECOVERY_VERIFIED");
      }
    }
    const frozen = await snapshot();
    if (!terminal(frozen) || frozen.settled)
      throw new Error("Expected uncredited frozen loot");
    const result = page.getByRole("dialog", {
      name: "Loot frozen · collect to credit",
    });
    await result
      .getByRole("button", { name: "Proof of roll", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Verify all reveals in your browser" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Proof of roll" }),
    ).toContainText("Match · all reveal rewards");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Collect loot", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Collect loot", exact: true })
      .click();
    await waitForSettlement(page, "LOOT COLLECTED", "Collect loot");
    const receipt = await readWager(wallet, frozen.index, true),
      credited = await readPlayer(wallet),
      house = await readHouse(wallet);
    if (
      !receipt?.settled ||
      !(await verifyHunt(receipt)) ||
      !credited ||
      credited.active ||
      credited.balance.toNumber() !== 9800 + receipt.payout ||
      !house ||
      house.balance.lt(house.reserved)
    )
      throw new Error("Browser settlement invariant failed");
    console.log(
      "BROWSER_SETTLED",
      JSON.stringify({
        wallet: authority.toBase58(),
        hunt: receipt.address.toBase58(),
        return: receipt.payout,
        balance: credited.balance.toNumber(),
        reveals: receipt.reveals,
      }),
    );
    await page.screenshot({ path: "/tmp/devnet-hunt-browser-settled.png" });
    await page.getByRole("button", { name: "Return to dungeon" }).click();
    await page
      .getByRole("button", { name: "Choose stake", exact: true })
      .click();
    await page.getByRole("button", { name: "Start hunt", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Cancel hunt · full refund" }),
    ).toBeEnabled({ timeout: 120_000 });
    await page
      .getByRole("button", { name: "Cancel hunt · full refund" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Collect refund", exact: true })
      .click();
    await waitForSettlement(page, "REFUNDED", "Collect refund");
    const final = await readPlayer(wallet);
    if (!final || final.active || !final.balance.eq(credited.balance))
      throw new Error("Cancellation failed to refund exactly");
    if (process.argv.includes("--interrupt") && interrupted.size !== 2)
      throw new Error(
        "Expected both request and settlement connection interruptions",
      );
    console.log(
      "BROWSER_CANCELLATION_VERIFIED",
      final.balance.toString(),
      "wallet approvals:",
      signatures,
    );
  } catch (error) {
    console.log("BROWSER_FAILURE", String(error));
    console.log(
      "BROWSER_VISIBLE_STATE",
      await page
        .locator(".quest-game")
        .innerText()
        .catch(() => "unavailable"),
    );
    const p = await readPlayer(wallet).catch(() => null);
    if (p?.active) {
      const run = await readWager(wallet, p.activeIndex.toNumber()).catch(
        () => null,
      );
      console.log(
        "BROWSER_UNRESOLVED",
        run
          ? {
              address: run.address.toBase58(),
              phase: run.phase,
              count: run.revealCount,
            }
          : "unreadable",
      );
    }
    await page
      .screenshot({ path: "/tmp/devnet-hunt-browser-failure.png" })
      .catch(() => {});
    // Driver failures never count as browser verification. Finish/refund any test hunt
    // while its disposable signing key is still in memory, instead of abandoning it.
    if (p?.active) {
      let run = await snapshot();
      if (run.phase === "active" && run.requestNonce === 0) {
        await cancelWager(wallet, run);
        run = await snapshot();
      }
      const session = (await createGameSession(wallet)).session;
      while (!terminal(run)) {
        const count = run.revealCount;
        if (run.phase === "active") {
          await authorizeWagerSession(wallet, run, session);
          const id = QUESTS.find((q) => !(run.openedMask & (1 << q.id)))!.id;
          await wagerAction(
            wallet,
            run,
            session,
            "risk",
            id,
            approachPath(QUESTS[id], { x: run.x, y: run.y }),
          );
        }
        for (let tick = 0; tick < 180; tick++) {
          await new Promise((r) => setTimeout(r, 1000));
          run = await snapshot();
          if (run.revealCount > count || terminal(run)) break;
        }
        if (run.revealCount === count && !terminal(run))
          throw new Error(
            "Test hunt remains pending; preserve the original request",
          );
      }
      await settleWager(wallet, run, console.log);
      console.log("BROWSER_FAILURE_RECOVERED", run.address.toBase58());
    }
    throw error;
  } finally {
    await browser.close();
    const player = await readPlayer(wallet).catch(() => null);
    if (!player?.active) {
      // Return remaining test-wallet SOL; both accounts are controlled by this verifier.
      const lamports = await base.getBalance(authority);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority,
          toPubkey: payer.publicKey,
          lamports: 1,
        }),
      );
      tx.feePayer = authority;
      tx.recentBlockhash = (await base.getLatestBlockhash()).blockhash;
      const fee = (await base.getFeeForMessage(tx.compileMessage())).value;
      if (fee !== null && lamports > fee) {
        tx.instructions[0] = SystemProgram.transfer({
          fromPubkey: authority,
          toPubkey: payer.publicKey,
          lamports: lamports - fee,
        });
        console.log("BROWSER_FUNDING_RETURN", await submit(base, wallet, tx));
      }
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
