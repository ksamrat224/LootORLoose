"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  activateRun,
  advanceRun,
  clearPendingSubmission,
  createGameSession,
  createRun,
  delegateRun,
  expireRun,
  finalizeRun,
  findLatestRun,
  isConfigured,
  openChest,
  pendingSubmission,
  readBaseReceipt,
  readRun,
  requestExtraction,
  revokeGameSession,
  submissionStatus,
  type GameSession,
  type RunSnapshot,
} from "@/lib/chain";
import {
  CHESTS,
  EARLY_EXIT,
  EXIT,
  INITIAL_DEMO,
  distance,
  isExit,
  isWalkable,
  pendingGold,
  type DemoState,
  type Direction,
  type Point,
} from "./model";
import { PhaserBoard } from "./PhaserBoard";

const STEP = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const MAX_PATH = 12;
const MAX_QUEUED = 24;
const SAVE_PREFIX = "loot-or-lose:v2:";

function display(
  state: RunSnapshot,
  position: Point,
  now: number,
  confirmed: boolean
): DemoState {
  const outcome =
    state.phase === "active"
      ? "active"
      : state.phase === "dead"
      ? "dead"
      : state.phase === "extracted"
      ? "escaped"
      : "timed_out";
  return {
    ...INITIAL_DEMO,
    ...position,
    hp: state.hp,
    opened: state.chestMask,
    secondsLeft: state.deadline ? Math.max(0, state.deadline - now) : 180,
    outcome,
    message: confirmed
      ? "ER checkpoint confirmed."
      : "Moving — checkpoint pending.",
  };
}

export function OnchainGame() {
  const wallet = useAnchorWallet();
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [position, setPosition] = useState<Point>({ x: 1, y: 1 });
  const [receipt, setReceipt] = useState<RunSnapshot | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Connect a devnet wallet to begin.");
  const [signature, setSignature] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [diagnostics, setDiagnostics] = useState(false);
  const [queued, setQueued] = useState(0);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const runRef = useRef<RunSnapshot | null>(null);
  const positionRef = useRef<Point>({ x: 1, y: 1 });
  const sessionRef = useRef<GameSession | null>(null);
  const queueRef = useRef<Direction[]>([]);
  const flightRef = useRef<Direction[]>([]);
  const uncertainRef = useRef<unknown>(null);
  const [lifecycle, setLifecycle] = useState("ready");
  const flushRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionRef = useRef(false);
  const storageKey = wallet
    ? `${SAVE_PREFIX}${wallet.publicKey.toBase58()}`
    : null;

  const setConfirmed = useCallback((latest: RunSnapshot) => {
    runRef.current = latest;
    setRun(latest);
    if (!flightRef.current.length) {
      let point = { x: latest.x, y: latest.y };
      for (const direction of queueRef.current) {
        const [dx, dy] = STEP[direction];
        const next = { x: point.x + dx, y: point.y + dy };
        if (!isWalkable(next.x, next.y)) break;
        point = next;
      }
      positionRef.current = point;
      setPosition(point);
    }
  }, []);
  const refresh = useCallback(
    async (index: number) => {
      if (!wallet) return;
      const [latest, baseState] = await Promise.all([
        readRun(wallet, index),
        readBaseReceipt(wallet, index),
      ]);
      if (latest) setConfirmed(latest);
      setReceipt(
        baseState &&
          ["extracted", "dead", "timedOut"].includes(baseState.phase) &&
          !baseState.delegated
          ? baseState
          : null
      );
      return latest;
    },
    [wallet, setConfirmed]
  );

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const saved =
      storageKey && window.localStorage.getItem(`${storageKey}:run`);
    const token =
      storageKey && window.localStorage.getItem(`${storageKey}:token`);
    const reset = window.setTimeout(() => {
      sessionRef.current = null;
      setSession(null);
      runRef.current = null;
      setRun(null);
      setReceipt(null);
      queueRef.current = [];
      flightRef.current = [];
      uncertainRef.current = null;
      if (wallet) {
        try {
          uncertainRef.current = pendingSubmission(wallet.publicKey);
        } catch (error) {
          uncertainRef.current = error;
        }
        if (uncertainRef.current) setLifecycle("reconciling");
      }
      setQueued(0);
      setSavedToken(token || null);
      if (!wallet || !isConfigured) return;
      if (saved && /^\d+$/.test(saved))
        void refresh(Number(saved)).catch((error) =>
          setMessage(`Recovery check: ${String(error)}`)
        );
      else
        void findLatestRun(wallet)
          .then((latest) => {
            if (latest) {
              window.localStorage.setItem(
                `${storageKey}:run`,
                String(latest.index)
              );
              setConfirmed(latest);
              void refresh(latest.index);
            }
          })
          .catch((error) => setMessage(`Recovery check: ${String(error)}`));
    }, 0);
    return () => window.clearTimeout(reset);
  }, [storageKey, wallet, refresh, setConfirmed]);

  const flush = useCallback((): Promise<void> => {
    if (flushRef.current) return flushRef.current;
    if (uncertainRef.current)
      return Promise.reject(
        new Error("Resolve the pending action before continuing")
      );
    if (
      !wallet ||
      !sessionRef.current ||
      !runRef.current ||
      !queueRef.current.length
    )
      return Promise.resolve();
    const task = (async () => {
      while (queueRef.current.length) {
        const current = runRef.current;
        const activeSession = sessionRef.current;
        if (!current || !activeSession || current.phase !== "active") {
          queueRef.current = [];
          break;
        }
        const path = queueRef.current.splice(0, MAX_PATH);
        flightRef.current = path;
        setLifecycle("submitting");
        setQueued(queueRef.current.length);
        try {
          setMessage(
            `Syncing ${path.length} step${
              path.length === 1 ? "" : "s"
            } to the ER…`
          );
          setSignature(await advanceRun(wallet, current, path, activeSession));
          const latest = await readRun(wallet, current.index);
          if (!latest)
            throw new Error(
              "Checkpoint confirmed, but run state could not be read."
            );
          flightRef.current = [];
          setConfirmed(latest);
          if (latest.phase !== "active") {
            queueRef.current = [];
            setQueued(0);
            const point = { x: latest.x, y: latest.y };
            positionRef.current = point;
            setPosition(point);
            break;
          }
          setLifecycle("active");
          setMessage(
            latest.hp < current.hp
              ? `Guardian struck! ${latest.hp} HP left. Your loot is still at risk.`
              : "Path confirmed on the ER."
          );
        } catch (error) {
          uncertainRef.current = error;
          setLifecycle("reconciling");
          queueRef.current = [];
          flightRef.current = [];
          setQueued(0);
          setMessage(
            `Checkpoint rejected or uncertain: ${String(
              error
            )}. Reading the ER before another action.`
          );
          try {
            const latest = await readRun(wallet, current.index);
            const status = await submissionStatus(error);
            if (
              latest &&
              (latest.nonce > current.nonce || status === "rejected")
            ) {
              uncertainRef.current = null;
              setLifecycle("active");
              setConfirmed(latest);
              const point = { x: latest.x, y: latest.y };
              positionRef.current = point;
              setPosition(point);
            }
          } catch {
            /* Keep original error visible. */
          }
          throw error;
        }
      }
    })();
    flushRef.current = task;
    void task.then(
      () => {
        if (flushRef.current === task) flushRef.current = null;
      },
      () => {
        if (flushRef.current === task) flushRef.current = null;
      }
    );
    return task;
  }, [wallet, setConfirmed]);

  const move = useCallback(
    (direction: Direction) => {
      const current = runRef.current;
      if (
        !current ||
        current.phase !== "active" ||
        !sessionRef.current ||
        interactionRef.current ||
        uncertainRef.current
      )
        return;
      if (Math.floor(Date.now() / 1000) >= sessionRef.current.expiresAt) {
        setMessage("Session expired. Authorize a new one to continue.");
        return;
      }
      if (queueRef.current.length >= MAX_QUEUED) {
        setMessage(
          "Syncing with the ER. Movement resumes after a checkpoint confirms."
        );
        return;
      }
      const [dx, dy] = STEP[direction];
      const next = {
        x: positionRef.current.x + dx,
        y: positionRef.current.y + dy,
      };
      if (!isWalkable(next.x, next.y)) {
        setMessage("A wall blocks the path.");
        return;
      }
      positionRef.current = next;
      setPosition(next);
      queueRef.current.push(direction);
      setQueued(queueRef.current.length);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (queueRef.current.length >= MAX_PATH || isExit(next))
        void flush().catch(() => {});
      else
        timerRef.current = setTimeout(() => {
          void flush().catch(() => {});
        }, 260);
    },
    [flush]
  );

  const action = useCallback(
    async (
      operation: (
        current: RunSnapshot,
        activeSession: GameSession
      ) => Promise<string>,
      success: string
    ) => {
      if (!wallet || interactionRef.current || uncertainRef.current) return;
      interactionRef.current = true;
      setBusy(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        await flush();
        const current = runRef.current;
        const activeSession = sessionRef.current;
        if (!current || !activeSession)
          throw new Error("Authorize a game session first.");
        setSignature(await operation(current, activeSession));
        await refresh(current.index);
        setMessage(success);
      } catch (error) {
        uncertainRef.current = error;
        setLifecycle("reconciling");
        setMessage(
          `Action rejected or uncertain: ${String(
            error
          )}. Checking the latest state.`
        );
        if (runRef.current)
          try {
            await refresh(runRef.current.index);
            if ((await submissionStatus(error)) !== "pending") {
              uncertainRef.current = null;
              setLifecycle("active");
            }
          } catch {
            /* Diagnostic remains visible. */
          }
      } finally {
        interactionRef.current = false;
        setBusy(false);
      }
    },
    [wallet, flush, refresh]
  );
  const walletAction = useCallback(
    async (operation: () => Promise<string | void>, success: string) => {
      if (interactionRef.current || uncertainRef.current) return;
      interactionRef.current = true;
      setBusy(true);
      try {
        await flush();
        const tx = await operation();
        if (tx) setSignature(tx);
        if (runRef.current) await refresh(runRef.current.index);
        setMessage(success);
      } catch (error) {
        uncertainRef.current = error;
        setLifecycle("reconciling");
        setMessage(
          `Transaction rejected or uncertain: ${String(
            error
          )}. Refresh status before retrying.`
        );
        if (runRef.current)
          try {
            await refresh(runRef.current.index);
          } catch {
            /* Keep diagnostic. */
          }
      } finally {
        interactionRef.current = false;
        setBusy(false);
      }
    },
    [refresh, flush]
  );

  const recover = async () => {
    if (!wallet || interactionRef.current) return;
    interactionRef.current = true;
    setBusy(true);
    try {
      const status = await submissionStatus(uncertainRef.current);
      if (runRef.current) await refresh(runRef.current.index);
      else {
        const latest = await findLatestRun(wallet);
        if (latest) await refresh(latest.index);
      }
      if (status === "pending") {
        setMessage(
          "The previous transaction is still pending. No action has been repeated."
        );
        return;
      }
      uncertainRef.current = null;
      setLifecycle("active");
      setMessage("Chain state recovered. Continue the existing run.");
      if (wallet) clearPendingSubmission(wallet.publicKey);
    } catch {
      setMessage(
        "Cannot reach devnet yet. Retry recovery when the connection returns."
      );
    } finally {
      interactionRef.current = false;
      setBusy(false);
    }
  };

  const start = () =>
    walletAction(async () => {
      if (!wallet || !storageKey) return;
      const created = await createRun(wallet);
      window.localStorage.setItem(`${storageKey}:run`, String(created.index));
      setSignature(created.signatures.at(-1) || null);
      await refresh(created.index);
    }, "Run created on Solana devnet. Delegate it to enter the dungeon.");
  const delegate = () =>
    walletAction(
      () => delegateRun(wallet!, runRef.current!.index),
      "Delegated. Wait for the router, then authorize a game session."
    );
  const authorize = () =>
    walletAction(async () => {
      const created = await createGameSession(wallet!);
      sessionRef.current = created.session;
      setSession(created.session);
      if (storageKey)
        window.localStorage.setItem(
          `${storageKey}:token`,
          created.session.token.toBase58()
        );
      setSavedToken(created.session.token.toBase58());
      return created.signature;
    }, "Session authorized for four minutes. Gameplay now signs without wallet popups.");
  const activate = () =>
    action(
      (current, activeSession) =>
        activateRun(wallet!, current.index, activeSession),
      "The three-minute run has started. Open a chest, then choose when to escape."
    );
  const interact = () =>
    action((current, activeSession) => {
      const id = CHESTS.findIndex(
        (chest, index) =>
          !(current.chestMask & (1 << index)) && distance(current, chest) <= 1
      );
      if (id < 0) throw new Error("Move next to an unopened chest.");
      return openChest(wallet!, current, id, activeSession);
    }, "Chest opened. Trap damage applied; fictional gold stays pending until extraction.");
  const extract = () =>
    action((current, activeSession) => {
      if (!isExit(current)) throw new Error("Stand on either exit tile first.");
      return requestExtraction(wallet!, current, activeSession);
    }, "Extraction frozen on ER. Commit it to Solana to secure the receipt.");
  const finalize = () =>
    walletAction(async () => {
      const result = await finalizeRun(wallet!, runRef.current!.index);
      for (let attempt = 0; attempt < 12; attempt++) {
        const settled = await readBaseReceipt(wallet!, runRef.current!.index);
        if (
          settled &&
          ["extracted", "dead", "timedOut"].includes(settled.phase)
        ) {
          setReceipt(settled);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return result.commitSignature || result.erSignature;
    }, "Commit submitted. The result is shown only after the Solana base-layer read confirms it.");
  const revoke = () =>
    walletAction(async () => {
      if (!wallet || !storageKey) return;
      const saved = window.localStorage.getItem(`${storageKey}:token`);
      if (!saved) throw new Error("No saved token address to revoke.");
      const tx = await revokeGameSession(wallet, new PublicKey(saved));
      sessionRef.current = null;
      setSession(null);
      window.localStorage.removeItem(`${storageKey}:token`);
      setSavedToken(null);
      return tx;
    }, "Session revoked. Authorize a new session to play again.");

  const shown = run ? display(run, position, now, queued === 0) : null;
  const secondsLeft = run?.deadline ? Math.max(0, run.deadline - now) : 180;
  const canExtract = run?.phase === "active" && isExit(position);
  const sessionReady =
    !!session &&
    session.expiresAt > now &&
    session.authority.equals(wallet?.publicKey || PublicKey.default);
  const link = signature
    ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    : null;
  return (
    <section className="onchain">
      <div className="section-title">
        <div>
          <p className="eyebrow">Solana devnet / MagicBlock ER</p>
          <h1>Dungeon run</h1>
        </div>
        <span className="demo-label">DEVNET</span>
      </div>
      <div className="chain-hero">
        <div>
          <p className="eyebrow">The wager</p>
          <h2>
            Take the gold.
            <br />
            <em>Keep your life.</em>
          </h2>
          <p>
            Chests pay 10, 40, or 100 demo gold, but the last two cost 15 or 35
            HP in traps. The guardian hits for 25 HP nearby. Cash out at the
            nearby hatch or push for the far vault.
          </p>
        </div>
        <div className="chain-wallet">
          <WalletMultiButton />
          <span>
            Devnet wallet ·{" "}
            {wallet
              ? `${wallet.publicKey.toBase58().slice(0, 6)}…${wallet.publicKey
                  .toBase58()
                  .slice(-4)}`
              : "not connected"}
          </span>
        </div>
      </div>
      <p className="message" role="status" aria-live="polite">
        {message}
      </p>
      {lifecycle === "reconciling" && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void recover()}
        >
          Recover pending action
        </button>
      )}
      {!isConfigured && (
        <div className="card">
          <strong>Onchain version not enabled yet.</strong>
          <p className="muted">
            The session-aware program must be deployed and verified before this
            mode is enabled. The local demo remains playable.
          </p>
        </div>
      )}
      {wallet && isConfigured && !run && (
        <div className="onchain-actions">
          <button className="button primary" disabled={busy} onClick={start}>
            Create devnet run
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void findLatestRun(wallet)
                .then(async (latest) => {
                  if (latest) await refresh(latest.index);
                  else setMessage("No earlier run found.");
                })
                .catch((error) => setMessage(String(error)))
            }
          >
            Recover latest run
          </button>
        </div>
      )}
      {wallet && run?.phase === "created" && !run.delegated && (
        <button className="button primary" disabled={busy} onClick={delegate}>
          Delegate to ER
        </button>
      )}
      {wallet && run?.phase === "created" && run.delegated && !sessionReady && (
        <div className="card session-card">
          <div>
            <p className="eyebrow">One-time game authorization</p>
            <h2>Play without a popup for every move.</h2>
            <p>
              This creates a temporary, program-scoped signer valid for four
              minutes and funds it with 0.002 devnet SOL for fees. It cannot
              transfer assets from your wallet or finalize the run, but its own
              fee balance can be spent. The key stays in this tab; reloading
              requires a new session. You can revoke the token from your wallet.
            </p>
          </div>
          <button
            className="button primary"
            disabled={busy}
            onClick={authorize}
          >
            Authorize game session
          </button>
        </div>
      )}
      {wallet && run?.phase === "created" && run.delegated && sessionReady && (
        <button className="button primary" disabled={busy} onClick={activate}>
          Enter dungeon · start 03:00 timer
        </button>
      )}
      {shown && (
        <div className="run-layout">
          <div className="game-area">
            <div className="board-frame">
              <PhaserBoard state={shown} onMove={move} onInteract={interact} />
            </div>
            <div className="controls">
              <span>
                <kbd>W A S D</kbd> / arrows move
              </span>
              <span>
                <kbd>E</kbd> opens chest
              </span>
              <span>Mint hatch: near exit · teal portal: far exit</span>
            </div>
          </div>
          <aside className="sidebar">
            <div className="card scorecard">
              <p className="eyebrow">Live run</p>
              <div className="stat">
                <span>Health</span>
                <strong>{run?.hp} / 100</strong>
              </div>
              <div className="meter">
                <span style={{ width: `${run?.hp || 0}%` }} />
              </div>
              <div className="stat">
                <span>Time</span>
                <strong className="mono">
                  {Math.floor(secondsLeft / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(secondsLeft % 60).toString().padStart(2, "0")}
                </strong>
              </div>
              <div className="stat">
                <span>Pending loot</span>
                <strong>
                  {run && ["dead", "timedOut"].includes(run.phase)
                    ? 0
                    : pendingGold(run?.chestMask || 0)}{" "}
                  demo gold
                </strong>
              </div>
              <p className="muted">
                Unbanked until extraction is confirmed on Solana.
              </p>
            </div>
            {run?.phase === "active" && (
              <div className="card choice-card">
                <p className="eyebrow">Your call</p>
                <h3>
                  {canExtract ? "Leave with what you have?" : "One more chest?"}
                </h3>
                <p>
                  {canExtract
                    ? "Extraction freezes your score. You can stop risking your haul now."
                    : `Near hatch ${EARLY_EXIT.x},${EARLY_EXIT.y} · far portal ${EXIT.x},${EXIT.y}. Trap costs: 0, 15, 35 HP.`}
                </p>
                <button
                  className="button primary full"
                  disabled={!canExtract || busy || !sessionReady}
                  onClick={extract}
                >
                  Extract now ↗
                </button>
              </div>
            )}
            {run?.phase === "active" && secondsLeft === 0 && (
              <button
                className="button secondary full"
                disabled={busy}
                onClick={() =>
                  walletAction(
                    () => expireRun(wallet!, run.index),
                    "Timed out on ER. Commit the failure result."
                  )
                }
              >
                Mark timed out
              </button>
            )}
            {run?.phase === "active" && !sessionReady && (
              <button
                className="button secondary full"
                disabled={busy}
                onClick={authorize}
              >
                Authorize new game session
              </button>
            )}
            {["extracting", "dead", "timedOut"].includes(run?.phase || "") &&
              run?.delegated && (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={finalize}
                >
                  Commit result to Solana
                </button>
              )}
            {receipt && (
              <div className="card result">
                <p className="eyebrow">Confirmed Solana receipt</p>
                <strong>
                  {receipt.phase === "extracted"
                    ? "EXTRACTED"
                    : receipt.phase.toUpperCase()}
                </strong>
                <p>
                  {receipt.phase === "extracted"
                    ? `${receipt.finalScore} fictional gold secured.`
                    : "No loot credited."}
                </p>
              </div>
            )}
            <button
              className="button secondary full"
              disabled={busy}
              onClick={() => run && void refresh(run.index)}
            >
              Refresh chain status
            </button>
            {receipt && (
              <button
                className="text-button"
                onClick={() => {
                  setRun(null);
                  runRef.current = null;
                  setReceipt(null);
                  if (storageKey)
                    window.localStorage.removeItem(`${storageKey}:run`);
                }}
              >
                Start another run
              </button>
            )}
          </aside>
        </div>
      )}
      <button
        className="text-button"
        onClick={() => setDiagnostics((value) => !value)}
        aria-expanded={diagnostics}
      >
        Technical details {diagnostics ? "−" : "+"}
      </button>
      {diagnostics && (
        <div className="diagnostics">
          <p>
            Program:{" "}
            {isConfigured
              ? "session-aware build configured"
              : "upgrade pending"}
          </p>
          <p>
            Run: {run?.address.toBase58() || "none"} ·{" "}
            {run?.phase || "not started"}
          </p>
          <p>
            State: {run?.source || "none"} · ER:{" "}
            {run?.endpoint || "not delegated"}
          </p>
          <p>
            Checkpoint: {queued} queued · confirmed nonce {run?.nonce ?? "—"}
          </p>
          <p>
            Session:{" "}
            {sessionReady
              ? `active until ${new Date(
                  session!.expiresAt * 1000
                ).toLocaleTimeString()}`
              : "not active"}
          </p>
          <p>Base receipt: {receipt?.phase || "not settled"}</p>
          {link && (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                Latest signature ↗
              </a>{" "}
              (may be an ER transaction)
            </p>
          )}
          {savedToken && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={revoke}
            >
              Revoke saved session token
            </button>
          )}
        </div>
      )}
    </section>
  );
}
