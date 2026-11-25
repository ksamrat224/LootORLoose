"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  clearPendingSubmission,
  createGameSession,
  pendingSubmission,
  PendingSubmission,
  submissionStatus,
  type GameSession,
} from "@/lib/chain";
import {
  authorizeWagerSession,
  cancelWager,
  createWager,
  delegateWager,
  initializeLedger,
  readPlayer,
  readWager,
  settleWager,
  terminal,
  wagerAction,
  wagerEnabled,
  waitForEr,
  type Wager,
} from "@/lib/wager-chain";
import { AwaitingCheckpoint, Checkpoints, type Step } from "./checkpoints";
import { GATES, gateReturn, money, parseStake } from "./wager-rules";
import { INITIAL_DEMO, distance, isWalkable } from "./model";
import { PhaserBoard } from "./PhaserBoard";
import { RollProof } from "./RollProof";

type Lifecycle =
  | "ready"
  | "preparing"
  | "active"
  | "submitting"
  | "reconciling"
  | "settling"
  | "settled";
const fresh = (stake: number): Wager => ({
  address: PublicKey.default,
  index: 0,
  stake,
  rulesVersion: 1,
  phase: "active",
  x: 1,
  y: 1,
  gate: 0,
  nonce: 0,
  requestNonce: 0,
  requestedAt: 0,
  payout: 0,
  delegated: false,
  settled: false,
  randomness: [],
});
function practiceRoll(denominator: number) {
  const limit = 0x100000000 - (0x100000000 % denominator);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % denominator;
}

export function WagerGame() {
  const wallet = useAnchorWallet();
  const walletKey = wallet?.publicKey.toBase58() || "";
  const [live, setLive] = useState(false);
  const [amount, setAmount] = useState("2.00");
  const [amountError, setAmountError] = useState("");
  const [balance, setBalance] = useState<number | null>(10000);
  const [run, setRun] = useState<Wager | null>(null);
  const [point, setPoint] = useState({ x: 1, y: 1 });
  const [lifecycle, setLifecycle] = useState<Lifecycle>("ready");
  const [message, setMessage] = useState(
    "Choose a demo stake. Your first gate is the Copper Watch."
  );
  const [details, setDetails] = useState(false);
  const [lastTransaction, setLastTransaction] = useState("");
  const [diagnosticError, setDiagnosticError] = useState("");
  const [now, setNow] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [sessionExpiry, setSessionExpiry] = useState(0);
  const current = useRef<Wager | null>(null);
  const movement = useRef(new Checkpoints({ x: 1, y: 1 }, isWalkable));
  const session = useRef<GameSession | null>(null);
  const locked = useRef(false);
  const flushing = useRef<Promise<void> | null>(null);
  const pendingError = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const identity = useRef(walletKey);
  const storageKey = `loot-or-lose:wager-v3:${walletKey}`;
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.authority === walletKey &&
        typeof detail.signature === "string"
      )
        setLastTransaction(detail.signature);
    };
    window.addEventListener("loot:transaction", receive);
    return () => window.removeEventListener("loot:transaction", receive);
  }, [walletKey]);

  const accept = useCallback((value: Wager, reconcile = true) => {
    const previous = current.current;
    if (
      previous?.index === value.index &&
      previous.address.equals(value.address) &&
      (previous.nonce > value.nonce || (previous.settled && !value.settled))
    )
      return;
    current.current = value;
    setRun(value);
    if (reconcile) {
      const queue = movement.current;
      if (queue.flight && value.nonce > queue.flight.nonce)
        queue.confirm(value, value.nonce, value.phase === "active");
      else if (!queue.flight) queue.confirmed = { x: value.x, y: value.y };
      if (value.phase !== "active") queue.queued = [];
      setPoint(queue.predict());
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!wallet || identity.current !== walletKey) return;
    const epoch = generation.current;
    const player = await readPlayer(wallet);
    const saved = window.localStorage.getItem(storageKey);
    const index = player?.active
      ? player.activeIndex.toNumber()
      : saved && /^\d+$/.test(saved)
      ? Number(saved)
      : null;
    const latest = index === null ? null : await readWager(wallet, index);
    if (epoch !== generation.current) return;
    const finalPlayer = latest?.settled ? await readPlayer(wallet) : player;
    if (epoch !== generation.current) return;
    setBalance(finalPlayer?.balance.toNumber() ?? 10000);
    if (latest) {
      accept(latest);
      window.localStorage.setItem(storageKey, String(latest.index));
      if (!locked.current && !pendingError.current)
        setLifecycle(
          latest.settled ? "settled" : terminal(latest) ? "settling" : "active"
        );
    }
  }, [wallet, walletKey, storageKey, accept]);

  useEffect(() => {
    generation.current++;
    identity.current = walletKey;
    current.current = null;
    session.current = null;
    locked.current = false;
    pendingError.current = null;
    flushing.current = null;
    if (timer.current) clearTimeout(timer.current);
    movement.current = new Checkpoints({ x: 1, y: 1 }, isWalkable);
    const start = setTimeout(() => {
      setHydrated(true);
      setRun(null);
      setPoint({ x: 1, y: 1 });
      setLifecycle("ready");
      setSessionExpiry(0);
      setBalance(live ? null : 10000);
      if (live && wallet) {
        try {
          pendingError.current = pendingSubmission(wallet.publicKey);
        } catch (error) {
          pendingError.current = error;
        }
        if (pendingError.current) {
          setLifecycle("reconciling");
          setMessage(
            "An earlier transaction needs recovery before play can continue."
          );
        }
      }
      if (live && wallet && wagerEnabled)
        void refresh().catch(() => {
          setLifecycle("reconciling");
          setMessage(
            "Could not read your run. Recover before starting another."
          );
        });
    }, 0);
    return () => {
      clearTimeout(start);
    };
    // Wallet identity, not wallet-adapter object identity, defines a new game context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, walletKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      if (
        live &&
        wallet &&
        current.current &&
        !locked.current &&
        !flushing.current &&
        !pendingError.current
      )
        void refresh().catch(() => {
          setMessage(
            "Connection interrupted. Your last result is retained; use Recover."
          );
        });
    }, 1500);
    return () => clearInterval(interval);
  }, [live, wallet, refresh]);

  const recover = async () => {
    if (!live || !wallet || locked.current || flushing.current) return;
    locked.current = true;
    setLifecycle("reconciling");
    try {
      const status = await submissionStatus(pendingError.current);
      await refresh();
      if (status === "pending") {
        setMessage(
          "Your submitted transaction is still pending. No action has been repeated."
        );
        return;
      }
      if (movement.current.flight) {
        const latest = current.current;
        if (
          !latest ||
          ((status === "applied" ||
            pendingError.current instanceof AwaitingCheckpoint) &&
            latest.nonce <= movement.current.flight.nonce)
        ) {
          setMessage(
            "Transaction confirmed; waiting for its state to become readable."
          );
          return;
        }
        movement.current.reject(latest);
        setPoint(movement.current.predict());
      }
      pendingError.current = null;
      clearPendingSubmission(wallet.publicKey);
      const latest = current.current;
      setLifecycle(
        latest?.settled
          ? "settled"
          : latest && terminal(latest)
          ? "settling"
          : latest
          ? "active"
          : "ready"
      );
      setMessage("State recovered. Continue the existing run.");
    } catch {
      setMessage(
        "Recovery could not reach devnet. Try again when the connection returns."
      );
    } finally {
      locked.current = false;
    }
  };

  const flush = (): Promise<void> => {
    if (flushing.current) return flushing.current;
    if (
      !live ||
      !wallet ||
      !current.current ||
      !session.current ||
      !movement.current.queued.length
    )
      return Promise.resolve();
    if (pendingError.current)
      return Promise.reject(new Error("Recover the pending action first"));
    const epoch = generation.current;
    const task = (async () => {
      while (movement.current.queued.length && epoch === generation.current) {
        const state = current.current!,
          activeSession = session.current!;
        const batch = movement.current.begin(state.nonce);
        if (!batch || state.phase !== "active") return;
        let confirmed = false;
        try {
          await wagerAction(
            wallet,
            state,
            activeSession,
            "advance",
            batch.path,
            () => {
              if (epoch !== generation.current)
                throw new Error("Wallet or game context changed");
            }
          );
          confirmed = true;
          const latest = await readWager(wallet, state.index);
          if (epoch !== generation.current) return;
          if (!latest || latest.nonce <= batch.nonce)
            throw new Error(
              "Checkpoint confirmation is awaiting state propagation"
            );
          accept(latest);
        } catch (error) {
          if (epoch !== generation.current) return;
          movement.current.uncertain = true;
          setDiagnosticError(String(error));
          pendingError.current = confirmed
            ? new AwaitingCheckpoint(batch.nonce)
            : error;
          setLifecycle("reconciling");
          setMessage(
            "Movement confirmation is uncertain. Recover before taking another risk."
          );
          throw error;
        }
      }
    })();
    flushing.current = task;
    void task.then(
      () => {
        if (flushing.current === task) flushing.current = null;
      },
      () => {
        if (flushing.current === task) flushing.current = null;
      }
    );
    return task;
  };

  const move = (step: Step) => {
    if (
      !current.current ||
      current.current.phase !== "active" ||
      locked.current ||
      pendingError.current ||
      lifecycle === "reconciling"
    )
      return;
    if (
      live &&
      (!session.current || session.current.expiresAt <= Date.now() / 1000)
    )
      return;
    if (!movement.current.enqueue(step)) return;
    setPoint(movement.current.predict());
    if (!live) {
      const next = {
        ...current.current,
        ...movement.current.predict(),
        nonce: current.current.nonce + 1,
      };
      movement.current.reject(next);
      accept(next);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 150);
    if (movement.current.queued.length >= 12) void flush().catch(() => {});
  };

  const operate = async (
    operation: (guard: () => void) => Promise<void>,
    next: Lifecycle = "active"
  ) => {
    if (locked.current || pendingError.current || lifecycle === "reconciling")
      return;
    locked.current = true;
    setLifecycle("submitting");
    const epoch = generation.current;
    try {
      await flush();
      if (epoch !== generation.current) return;
      await operation(() => {
        if (epoch !== generation.current)
          throw new Error("Wallet or game context changed");
      });
      if (epoch === generation.current)
        setLifecycle(
          current.current?.settled
            ? "settled"
            : current.current && terminal(current.current)
            ? "settling"
            : next
        );
    } catch (error) {
      if (epoch !== generation.current) return;
      pendingError.current = error;
      setDiagnosticError(String(error));
      setLifecycle("reconciling");
      setMessage(
        error instanceof PendingSubmission
          ? "Transaction submitted; confirmation is uncertain. Recover before retrying."
          : "The action could not complete. Recover to check your current run; details are available below."
      );
    } finally {
      if (epoch === generation.current) locked.current = false;
    }
  };

  const start = () => {
    const stake = parseStake(amount);
    if (stake === null) {
      setAmountError("Enter $1.00–$100.00 with at most two decimal places.");
      return;
    }
    if (stake > (balance ?? 0)) {
      setAmountError("Your demo balance is too low for this stake.");
      return;
    }
    setAmountError("");
    void operate(async (guard) => {
      if (!live) {
        setBalance((value) => (value ?? 10000) - stake);
        accept(fresh(stake));
        setMessage(
          "Safe passage. Walk to gate 1 and press E when you choose to risk the stake."
        );
        return;
      }
      if (!wallet) throw new Error("Connect a devnet wallet");
      setLifecycle("preparing");
      setMessage("Preparing your demo ledger…");
      await initializeLedger(wallet, guard);
      guard();
      const index = await createWager(wallet, stake, guard);
      guard();
      window.localStorage.setItem(storageKey, String(index));
      const created = await readWager(wallet, index);
      guard();
      if (!created) throw new Error("Wager created; waiting for its state");
      accept(created);
      if (!created.delegated) {
        setMessage("Approve delegation to enter the dungeon…");
        await delegateWager(wallet, index, guard);
        guard();
      }
      setMessage("Waiting for the dungeon connection…");
      await waitForEr(wallet, index);
      guard();
      setMessage(
        "Authorize four minutes of gameplay · 0.002 devnet SOL fee top-up…"
      );
      const authorized = await createGameSession(wallet, guard);
      guard();
      session.current = authorized.session;
      await authorizeWagerSession(
        wallet,
        current.current!,
        authorized.session,
        guard
      );
      guard();
      setSessionExpiry(authorized.session.expiresAt);
      await refresh();
      setMessage("Dungeon ready. Walk to gate 1; risk only when you choose.");
    });
  };

  const risk = () =>
    void operate(async (guard) => {
      const state = current.current!;
      const gate = GATES[state.gate];
      if (!gate || distance(movement.current.predict(), gate) > 1)
        throw new Error("Stand beside the next numbered gate");
      if (!live) {
        accept({
          ...state,
          phase: "randomnessPending",
          requestedAt: Math.floor(Date.now() / 1000),
        });
        setMessage("Practice roll in progress…");
        await new Promise((resolve) => setTimeout(resolve, 600));
        guard();
        const survived = practiceRoll(gate.denominator) < gate.numerator;
        const nextGate = survived ? state.gate + 1 : state.gate;
        const value: Wager = {
          ...state,
          gate: nextGate,
          nonce: state.nonce + 2,
          requestedAt: Math.floor(Date.now() / 1000),
          phase: !survived ? "lost" : nextGate === 3 ? "extracting" : "active",
          payout: survived && nextGate === 3 ? gateReturn(state.stake, 3) : 0,
        };
        accept(value);
        setMessage(
          survived
            ? `Gate cleared. ${
                GATES[nextGate - 1].multiplier
              } total return is available.`
            : "The guardian kept the stake. This run returns $0.00 demo credits."
        );
        return;
      }
      await wagerAction(wallet!, state, session.current!, "risk", [], guard);
      guard();
      await refresh();
      guard();
      setMessage(
        "Randomness pending. The gate is locked to this request; no rerolls."
      );
    });

  const extract = () =>
    void operate(async (guard) => {
      const state = current.current!;
      if (!live)
        accept({
          ...state,
          phase: "extracting",
          payout: gateReturn(state.stake, state.gate),
        });
      else {
        await wagerAction(
          wallet!,
          state,
          session.current!,
          "extract",
          [],
          guard
        );
        guard();
        await refresh();
      }
      guard();
      setMessage("Return frozen. Settle the run to credit your demo balance.");
    }, "settling");
  const cancel = () =>
    void operate(async (guard) => {
      const state = current.current!;
      if (!live) accept({ ...state, phase: "cancelled", payout: state.stake });
      else {
        await cancelWager(wallet!, state, guard);
        guard();
        await refresh();
      }
      guard();
      setMessage(
        "Stake refund frozen. Settle the run to return the demo credits."
      );
    }, "settling");
  const settle = () =>
    void operate(async (guard) => {
      const state = current.current!;
      if (!live) {
        if (!state.settled) setBalance((value) => (value ?? 0) + state.payout);
        accept({ ...state, settled: true });
      } else {
        await settleWager(
          wallet!,
          state,
          (message) => {
            guard();
            setMessage(message);
          },
          guard
        );
        guard();
        await refresh();
      }
      guard();
      setMessage("Settled. Your demo balance reflects the confirmed result.");
    }, "settled");
  const resume = () =>
    void operate(async (guard) => {
      if (!wallet || !current.current) return;
      if (!current.current.delegated) {
        const index = current.current.index;
        await delegateWager(wallet, index, guard);
        guard();
        await waitForEr(wallet, index);
        guard();
      }
      const authorized = await createGameSession(wallet, guard);
      guard();
      session.current = authorized.session;
      await authorizeWagerSession(
        wallet,
        current.current,
        authorized.session,
        guard
      );
      guard();
      setSessionExpiry(authorized.session.expiresAt);
      await refresh();
      setMessage("Session ready. Continue your existing run.");
    });

  const busy = ["preparing", "submitting"].includes(lifecycle);
  const blocked = busy || lifecycle === "reconciling";
  const pending = run?.phase === "randomnessPending";
  const currentReturn = run
    ? run.gate
      ? gateReturn(run.stake, run.gate)
      : run.stake
    : 0;
  const nextGate = run ? GATES[run.gate] : GATES[0];
  const canRisk =
    !!run &&
    run.phase === "active" &&
    nextGate &&
    distance(point, nextGate) <= 1 &&
    !blocked &&
    (!live || sessionExpiry > now);
  const board = {
    ...INITIAL_DEMO,
    ...point,
    opened: run ? (1 << run.gate) - 1 : 0,
    hp: 100,
    secondsLeft: 0,
    outcome:
      run?.phase === "active" ? ("active" as const) : ("escaped" as const),
  };
  return (
    <section className="wager" aria-busy={busy}>
      <div className="wager-heading">
        <div>
          <p className="eyebrow">The three-gate dungeon</p>
          <h1>
            Keep the haul.
            <br />
            <em>Or tempt the next guardian.</em>
          </h1>
          <p>
            Safe steps. Risky doors. You decide when the treasure is enough.
          </p>
        </div>
        <div className="wager-wallet">
          <span className="demo-label">DEMO CREDITS · NO CASH VALUE</span>
          {live && <WalletMultiButton />}
          <span className="muted">
            {live
              ? "Solana devnet · verified random gates"
              : "Local practice · browser randomness"}
          </span>
        </div>
      </div>
      <fieldset
        className="wager-mode"
        disabled={(!!run && !run.settled) || busy}
      >
        <legend>Play mode</legend>
        <label>
          <input
            type="radio"
            name="wager-mode"
            checked={!live}
            onChange={() => setLive(false)}
          />{" "}
          Local practice
        </label>
        <label>
          <input
            type="radio"
            name="wager-mode"
            checked={live}
            disabled={!wagerEnabled}
            onChange={() => setLive(true)}
          />{" "}
          Devnet wager {wagerEnabled ? "" : "· verification pending"}
        </label>
      </fieldset>
      <div className="odds-ladder" aria-label="Published gate odds">
        {GATES.map((gate, index) => (
          <div
            key={gate.name}
            className={`gate-card ${gate.color} ${
              run && run.gate > index ? "cleared" : ""
            }`}
          >
            <span>
              0{index + 1} / {gate.name}
            </span>
            <strong>{gate.multiplier}</strong>
            <p>{gate.odds} chance at this gate</p>
            <small>
              {run && run.gate > index
                ? "✓ Cleared"
                : "Total return, including stake"}
            </small>
          </div>
        ))}
      </div>
      <p className="muted odds-note">
        95% theoretical return before cent rounding for each fixed extraction
        strategy. Every failed gate returns zero. No real deposits, withdrawals,
        or cash prizes.
      </p>
      <p className="message" role="status" aria-live="polite">
        {message}
      </p>
      {lifecycle === "reconciling" && (
        <button className="button primary" onClick={() => void recover()}>
          Recover existing run
        </button>
      )}
      {!run ? (
        <div className="wager-start">
          <form
            className="card stake-form"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <p className="eyebrow">Pack light. Choose your stake.</p>
            <div className="stat">
              <span>Demo balance</span>
              <strong>{balance === null ? "Loading…" : money(balance)}</strong>
            </div>
            <div className="stake-presets">
              {["2.00", "5.00"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="button secondary"
                  aria-pressed={amount === value}
                  onClick={() => {
                    setAmount(value);
                    setAmountError("");
                  }}
                >
                  ${value} demo
                </button>
              ))}
            </div>
            <label htmlFor="demo-stake">Stake in demo credits</label>
            <input
              id="demo-stake"
              disabled={!hydrated}
              inputMode="decimal"
              type="text"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onBlur={() =>
                setAmountError(
                  parseStake(amount) === null
                    ? "Enter $1.00–$100.00 with at most two decimals."
                    : ""
                )
              }
              aria-invalid={!!amountError}
              aria-describedby="stake-help stake-error"
            />
            <p id="stake-help" className="muted">
              $1–$100 demo. A $5 stake at 2× returns $10 total, including your
              stake.
            </p>
            <p id="stake-error" className="field-error">
              {amountError}
            </p>
            <button
              className="button primary full"
              disabled={
                !hydrated || blocked || (live && (!wallet || balance === null))
              }
              type="submit"
            >
              {busy
                ? "Preparing dungeon…"
                : live
                ? "Start devnet run"
                : "Start practice run"}
            </button>
            {live && (
              <p className="muted">
                Wallet approvals prepare the run and a four-minute session.
                Session top-up: 0.002 devnet SOL plus network fees. Gameplay
                uses the temporary signer.
              </p>
            )}
          </form>
          <div className="card wager-guide">
            <p className="eyebrow">Your route through the vault</p>
            <ol>
              <li>
                Walk freely to the numbered guardian. Movement never loses the
                stake.
              </li>
              <li>
                Press E or choose “Risk gate” to accept its published chance.
              </li>
              <li>
                After a win, extract immediately or walk to the next gate.
              </li>
            </ol>
            <p>
              Cancel before your first risk for a full demo stake refund. At 3×
              the return freezes automatically.
            </p>
            {!wagerEnabled && (
              <p className="muted">
                Devnet wagering stays disabled until deployment, browser
                recovery, VRF, and settlement are verified. The original free
                modes remain available.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="run-layout wager-run">
          <div>
            <div className="board-frame">
              <PhaserBoard
                state={board}
                onMove={move}
                onInteract={risk}
                wagerMode
              />
            </div>
            <div className="controls">
              <span>
                <kbd>W A S D</kbd> / arrows move
              </span>
              <span>
                <kbd>E</kbd> risk nearby gate
              </span>
              <span>Movement is safe · no financial timer</span>
            </div>
            {pending && (
              <div className="card pending-gate">
                <p className="eyebrow">Randomness pending</p>
                <h2>The guardian is deciding.</h2>
                <p>
                  {now - run.requestedAt >= 60
                    ? "The randomness service is delayed. Your existing request stays pending. Recover checks the same request; it does not reroll."
                    : "One request. One result. The next risk and extraction unlock after this gate resolves."}
                </p>
                {live && (
                  <button
                    className="button secondary"
                    onClick={() => void recover()}
                  >
                    Check existing request
                  </button>
                )}
              </div>
            )}
          </div>
          <aside className="sidebar">
            <div className="card">
              <p className="eyebrow">Your haul · demo credits</p>
              <div className="stat">
                <span>Stake</span>
                <strong>{money(run.stake)}</strong>
              </div>
              <div className="stat">
                <span>Available balance</span>
                <strong>
                  {balance === null ? "Loading…" : money(balance)}
                </strong>
              </div>
              <div className="stat">
                <span>
                  {terminal(run)
                    ? "Frozen total return"
                    : "Current total return"}
                </span>
                <strong>
                  {money(terminal(run) ? run.payout : currentReturn)}
                </strong>
              </div>
              <div className="stat">
                <span>Net profit if extracted</span>
                <strong>
                  {money(
                    (terminal(run) ? run.payout : currentReturn) - run.stake
                  )}
                </strong>
              </div>
              <p className="muted">
                {run.settled
                  ? live
                    ? "Credit confirmed on Solana devnet."
                    : "Practice balance credited locally."
                  : pending
                  ? "No cash-out is available while this gate is pending."
                  : "Return includes your original stake."}
              </p>
            </div>
            {run.phase === "active" && (
              <div className="card choice-card">
                <p className="eyebrow">Your call</p>
                <h3>{nextGate?.name}</h3>
                <p>
                  {nextGate?.odds} chance to reach {nextGate?.multiplier} ·{" "}
                  {money(gateReturn(run.stake, run.gate + 1))} total return.
                  Failure returns $0.00.
                </p>
                <div className="wager-choices">
                  <button
                    className="button secondary full"
                    disabled={
                      blocked || !run.gate || (live && sessionExpiry <= now)
                    }
                    onClick={extract}
                  >
                    Extract {money(currentReturn)}
                  </button>
                  <button
                    className="button primary full"
                    disabled={!canRisk}
                    onClick={risk}
                  >
                    Risk gate {run.gate + 1}
                  </button>
                </div>
                {!canRisk && !blocked && (
                  <p className="muted">
                    {live && sessionExpiry <= now
                      ? "Authorize a session to continue."
                      : `Walk beside gate ${run.gate + 1} at (${nextGate?.x}, ${
                          nextGate?.y
                        }).`}
                  </p>
                )}
                {run.gate === 0 && !run.requestedAt && (
                  <button
                    className="text-button"
                    disabled={blocked}
                    onClick={cancel}
                  >
                    Cancel · return full stake
                  </button>
                )}
              </div>
            )}
            {live && run.phase === "active" && sessionExpiry <= now && (
              <button
                className="button primary"
                disabled={blocked}
                onClick={resume}
              >
                Resume · authorize session
              </button>
            )}
            {live && <RollProof run={run} />}
            {terminal(run) && (
              <div className="card result">
                <p className="eyebrow">
                  {run.settled
                    ? "Settled result"
                    : "Frozen result · settlement required"}
                </p>
                <strong>
                  {run.settled
                    ? run.phase === "lost"
                      ? "LOST"
                      : run.phase === "cancelled"
                      ? "REFUNDED"
                      : "EXTRACTED"
                    : run.phase === "lost"
                    ? "Gate failed"
                    : "Return frozen"}
                </strong>
                <p>
                  {money(run.payout)} demo credits{" "}
                  {run.settled ? "credited" : "to credit"}.
                </p>
                {!run.settled ? (
                  <button
                    className="button primary full"
                    disabled={blocked}
                    onClick={settle}
                  >
                    Settle {live ? "on Solana" : "practice result"}
                  </button>
                ) : (
                  <button
                    className="button secondary full"
                    onClick={() => {
                      current.current = null;
                      movement.current = new Checkpoints(
                        { x: 1, y: 1 },
                        isWalkable
                      );
                      setRun(null);
                      setPoint({ x: 1, y: 1 });
                      setLifecycle("ready");
                    }}
                  >
                    Choose another stake
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
      <button
        className="text-button"
        aria-expanded={details}
        onClick={() => setDetails(!details)}
      >
        Technical details {details ? "−" : "+"}
      </button>
      {details && (
        <div className="diagnostics">
          {diagnosticError && <p>Latest error: {diagnosticError}</p>}
          {lastTransaction && (
            <p>
              <a
                href={`https://explorer.solana.com/tx/${lastTransaction}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                Latest transaction ↗
              </a>{" "}
              · ER signatures may not appear in the base explorer.
            </p>
          )}
          <p>
            Mode: {live ? "devnet VRF" : "local simulation; no VRF proof"} ·
            lifecycle: {lifecycle}
          </p>
          <p>
            Rules: 1 · stake cents: {run?.stake ?? "none"} · gate:{" "}
            {run?.gate ?? 0}
          </p>
          <p>
            Run: {run?.address.toBase58() || "none"} · nonce:{" "}
            {run?.nonce ?? "none"}
          </p>
          <p>
            ER: {run?.endpoint || "not delegated"} · request:{" "}
            {run?.requestNonce ?? "none"}
          </p>
          <p>
            Session expiry: {sessionExpiry || "none"} · credit confirmed:{" "}
            {String(run?.settled ?? false)}
          </p>
          {live && run && (
            <a
              href={`https://explorer.solana.com/address/${run.address}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              Inspect devnet receipt ↗
            </a>
          )}
        </div>
      )}
    </section>
  );
}
