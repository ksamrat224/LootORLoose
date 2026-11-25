"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  createGameSession,
  pendingSubmission,
  submissionStatus,
  clearPendingSubmission,
  PendingSubmission,
  type GameSession,
} from "@/lib/chain";
import {
  authorizeWagerSession,
  cancelWager,
  createWager,
  delegateWager,
  initializeLedger,
  questEnabled,
  readPlayer,
  readWager,
  settleWager,
  terminal,
  wagerAction,
  waitForEr,
  type Wager,
} from "@/lib/quest-chain";
import { readPlayer as readV3Player } from "@/lib/wager-chain";
import { INITIAL_DEMO, isWalkable, distance, type Direction } from "./model";
import {
  QUESTS,
  UNCHOSEN_QUEST,
  STEP_DELTAS,
  approachPath,
  practiceSuccess,
  questReturn,
} from "./quest-rules";
import { money, parseStake } from "./wager-rules";
import { PhaserBoard } from "./PhaserBoard";
import { QuestDialog } from "./QuestDialog";
import { QuestProof } from "./QuestProof";

type Panel =
  | "quests"
  | "stake"
  | "confirm"
  | "proof"
  | "details"
  | "result"
  | null;
const STEPS = [
  "Prepare demo credits",
  "Reserve this quest",
  "Connect the dungeon",
  "Authorize gameplay",
];
export function QuestGame() {
  const wallet = useAnchorWallet(),
    walletKey = wallet?.publicKey.toBase58() || "";
  const [live, setLive] = useState(false);
  const [point, setPoint] = useState({ x: 1, y: 1 });
  const [selected, setSelected] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [amount, setAmount] = useState("2.00");
  const [amountError, setAmountError] = useState("");
  const [practiceBalance, setPracticeBalance] = useState(10000);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [attempt, setAttempt] = useState<Wager | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState(
    "Choose your stake first, then explore and hunt any quest."
  );
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [expiry, setExpiry] = useState(0);
  const [sound, setSound] = useState(false);
  const state = useRef<Wager | null>(null),
    position = useRef(point),
    session = useRef<GameSession | null>(null);
  const epoch = useRef(0),
    locked = useRef(false),
    pending = useRef<unknown>(null),
    generationKey = useRef("");
  const identity = `${live}:${walletKey}`;

  const journal = `loot-or-lose:quest-v4:${walletKey}`;
  const balance = live ? liveBalance : practiceBalance;
  const accept = useCallback((value: Wager) => {
    const previous = state.current;
    if (
      previous?.address.equals(value.address) &&
      (previous.nonce > value.nonce || (previous.settled && !value.settled))
    )
      return;
    state.current = value;
    setAttempt(value);
    if (value.questId < QUESTS.length) setSelected(value.questId);
    if (!previous || value.phase !== "active") {
      position.current = { x: value.x, y: value.y };
      setPoint(position.current);
    }
  }, []);
  const guardFor = () => {
    const stamp = epoch.current,
      key = identity;
    return () => {
      if (epoch.current !== stamp || generationKey.current !== key)
        throw new Error("Wallet or game context changed");
    };
  };
  const refresh = useCallback(async () => {
    if (!wallet || !questEnabled) return;
    const stamp = epoch.current;
    const old = await readV3Player(wallet);
    if (stamp !== epoch.current) return;
    setLegacy(!!old?.active);
    if (old?.active) {
      setLoaded(true);
      return;
    }
    const player = await readPlayer(wallet);
    if (stamp !== epoch.current) return;
    const saved = localStorage.getItem(journal);
    const index = player?.active
      ? player.activeIndex.toNumber()
      : saved && /^\d+$/.test(saved)
      ? Number(saved)
      : null;
    const latest = index === null ? null : await readWager(wallet, index);
    if (stamp !== epoch.current) return;
    setLiveBalance(player?.balance.toNumber() ?? 10000);
    if (latest) {
      const firstRead = !state.current;
      accept(latest);
      localStorage.setItem(journal, String(latest.index));
      if (firstRead && !pending.current)
        setMessage(
          latest.settled
            ? "This earlier attempt is settled. Explore for your next quest."
            : terminal(latest)
            ? "Your result is frozen. Open the result to complete settlement."
            : latest.phase === "randomnessPending"
            ? "Your existing VRF request is pending. No new attempt has been created."
            : "Existing attempt recovered. Authorize gameplay to continue it."
        );
    }
    setLoaded(true);
  }, [wallet, journal, accept]);
  useEffect(() => {
    generationKey.current = identity;
    epoch.current++;
    locked.current = false;
    session.current = null;
    pending.current = null;
    state.current = null;
    const timeout = setTimeout(() => {
      setAttempt(null);
      setPanel(null);
      setBusy(false);
      setStage("");
      setRecovering(false);
      setError("");
      setLegacy(false);
      setLoaded(!live);
      setExpiry(0);
      setLiveBalance(null);
      setMessage(
        live
          ? "Connect a wallet to prepare a V4 quest attempt."
          : "Choose your stake first, then explore and hunt any quest."
      );
      if (live && wallet && questEnabled) {
        try {
          pending.current = pendingSubmission(wallet.publicKey);
          if (pending.current) {
            setRecovering(true);
            setMessage(
              "An earlier submission needs recovery. No new attempt will be created."
            );
          }
        } catch (e) {
          pending.current = e;
          setRecovering(true);
        }
        const stamp = epoch.current;
        void refresh().catch((e) => {
          if (stamp !== epoch.current) return;
          setError(String(e));
          setRecovering(true);
          setMessage(
            "Could not read your devnet state. Recover before preparing another attempt."
          );
        });
      }
    }, 0);
    return () => clearTimeout(timeout);
    // Wallet identity and mode define a disposable context; refresh reads current public recovery metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, walletKey]);
  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      if (
        live &&
        wallet &&
        state.current &&
        !locked.current &&
        !inFlight &&
        !pending.current
      ) {
        inFlight = true;
        const stamp = epoch.current;
        void refresh()
          .catch(() => {
            if (stamp === epoch.current)
              setMessage(
                "Connection delayed. Your existing attempt is retained; use Recover."
              );
          })
          .finally(() => {
            inFlight = false;
          });
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [live, wallet, refresh]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setSound(localStorage.getItem("loot-sound") === "on");
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const previousPhase = useRef("");
  useEffect(() => {
    const current = attempt?.phase || "";
    const previous = previousPhase.current;
    previousPhase.current = current;
    if (
      !sound ||
      !previous ||
      previous === current ||
      !["succeeded", "lost"].includes(current)
    )
      return;
    try {
      const audio = new AudioContext(),
        osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.frequency.value = current === "lost" ? 160 : 660;
      gain.gain.setValueAtTime(0.03, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.3);
      osc.onended = () => {
        void audio.close();
      };
    } catch {}
  }, [attempt, sound]);
  const operate = async (action: (guard: () => void) => Promise<void>) => {
    if (locked.current || pending.current || recovering) return;
    const guard = guardFor();
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await action(guard);
      guard();
    } catch (e) {
      try {
        guard();
      } catch {
        return;
      }
      pending.current = e;
      setError(String(e));
      setRecovering(true);
      setMessage(
        e instanceof PendingSubmission
          ? "Submission received; confirmation is uncertain. Recover this attempt before retrying."
          : "The action needs a state check. Recover your existing attempt to continue."
      );
      setPanel(null);
    } finally {
      try {
        guard();
        locked.current = false;
        setBusy(false);
        setStage("");
      } catch {}
    }
  };
  const recover = async () => {
    if (!live || !wallet || locked.current) return;
    const guard = guardFor();
    locked.current = true;
    setBusy(true);
    try {
      const status = await submissionStatus(pending.current);
      guard();
      await refresh();
      guard();
      if (status === "pending") {
        setMessage(
          "The same transaction is still pending. No new attempt has been submitted."
        );
        return;
      }
      clearPendingSubmission(wallet.publicKey);
      pending.current = null;
      setRecovering(false);
      setError("");
      setMessage("Your existing attempt is recovered. Continue when ready.");
    } catch (e) {
      try {
        guard();
        setError(String(e));
        setMessage(
          "Recovery could not reach devnet. Try again when the connection returns."
        );
      } catch {}
    } finally {
      try {
        guard();
        locked.current = false;
        setBusy(false);
      } catch {}
    }
  };
  const move = (direction: Direction) => {
    if (
      panel ||
      locked.current ||
      !state.current ||
      state.current.phase !== "active" ||
      state.current.questId !== UNCHOSEN_QUEST ||
      recovering ||
      legacy
    )
      return;
    const [dx, dy] = STEP_DELTAS[direction],
      next = { x: position.current.x + dx, y: position.current.y + dy };
    if (isWalkable(next.x, next.y)) {
      position.current = next;
      setPoint(next);
    }
  };
  const nearby = QUESTS.find((q) => distance(point, q) <= 1);
  const q =
    QUESTS[
      attempt && attempt.questId < 6 ? attempt.questId : nearby?.id ?? selected
    ];
  const openStake = () => {
    if (locked.current || panel || recovering || legacy) return;
    if (state.current && !state.current.settled) {
      setMessage(
        "Finish or recover your current attempt before choosing another stake."
      );
      return;
    }
    if (live && (!wallet || !loaded || legacy)) {
      setMessage(
        legacy
          ? "Recover your unresolved V3 run first."
          : "Connect your wallet and wait for the ledger check first."
      );
      return;
    }
    setAmountError("");
    setPanel("stake");
  };
  const prepare = () => {
    const stake = parseStake(amount);
    if (stake === null) {
      setAmountError("Enter $1.00–$100.00 with at most two decimals.");
      return;
    }
    if (stake > (balance ?? 0)) {
      setAmountError("Your demo balance is too low for this stake.");
      return;
    }
    setAmountError("");
    setPanel(null);
    void operate(async (guard) => {
      if (!live) {
        setPracticeBalance((b) => b - stake);
        accept({
          address: PublicKey.default,
          index: 0,
          stake,
          rulesVersion: 4,
          questId: UNCHOSEN_QUEST,
          phase: "active",
          ...position.current,
          nonce: 0,
          requestNonce: 0,
          requestedAt: 0,
          payout: 0,
          delegated: false,
          settled: false,
          randomness: [],
        });
        setMessage(
          "Stake reserved. Hunt any quest. You can cancel for a full refund before attempting one."
        );
        return;
      }
      if (!wallet) throw new Error("Connect a devnet wallet");
      setStage(STEPS[0]);
      setMessage("Approve demo ledger setup if your wallet requests it.");
      await initializeLedger(wallet, guard);
      guard();
      setStage(STEPS[1]);
      setMessage(
        "Approve your stake. Choose which quest to face after entering the dungeon."
      );
      const index = await createWager(wallet, stake, UNCHOSEN_QUEST, [], guard);
      guard();
      localStorage.setItem(journal, String(index));
      const created = await readWager(wallet, index);
      guard();
      if (!created) throw new Error("Waiting for the created quest state");
      accept(created);
      setStage(STEPS[2]);
      if (!created.delegated) {
        await delegateWager(wallet, index, guard);
        guard();
      }
      await waitForEr(wallet, index);
      guard();
      setStage(STEPS[3]);
      setMessage(
        "Authorize four minutes of gameplay · 0.002 devnet SOL plus fees."
      );
      const authorized = await createGameSession(wallet, guard);
      guard();
      session.current = authorized.session;
      await authorizeWagerSession(wallet, created, authorized.session, guard);
      guard();
      setExpiry(authorized.session.expiresAt);
      await refresh();
      guard();
      setMessage(
        "Stake ready. Explore and hunt any quest; the choice is yours."
      );
    });
  };
  const attemptQuest = () => {
    const current = state.current;
    if (!current || current.phase !== "active") return;
    const target = QUESTS.find(
      (quest) => distance(position.current, quest) <= 1
    );
    if (!target) {
      setMessage(
        "Your stake is reserved. Walk beside any quest to attempt it."
      );
      return;
    }
    if (
      live &&
      (!session.current || session.current.expiresAt <= Date.now() / 1000)
    ) {
      setMessage("Authorize a gameplay session before attempting a quest.");
      return;
    }
    const path = approachPath(position.current);
    setPanel(null);
    void operate(async (guard) => {
      if (!live) {
        accept({
          ...current,
          ...position.current,
          questId: target.id,
          phase: "randomnessPending",
          requestedAt: Math.floor(Date.now() / 1000),
        });
        setMessage("Practice roll in progress · browser randomness.");
        await new Promise((r) => setTimeout(r, 900));
        guard();
        const success = practiceSuccess(target.id);
        accept({
          ...current,
          ...position.current,
          questId: target.id,
          phase: success ? "succeeded" : "lost",
          payout: success ? questReturn(current.stake, target.id) : 0,
          nonce: 2,
        });
        setMessage("Result frozen. Settle it to update your practice balance.");
        setPanel("result");
        return;
      }
      await wagerAction(
        wallet!,
        current,
        session.current!,
        "risk",
        target.id,
        path,
        guard
      );
      guard();
      await refresh();
      guard();
      setMessage(
        "One VRF request is pending. This attempt cannot be rerolled."
      );
    });
  };
  const cancel = () => {
    const current = state.current;
    if (!current || current.phase !== "active") return;
    void operate(async (guard) => {
      if (live) {
        await cancelWager(wallet!, current, guard);
        guard();
        await refresh();
        guard();
      } else
        accept({
          ...current,
          phase: "cancelled",
          payout: current.stake,
          nonce: current.nonce + 1,
        });
      setMessage("Stake refund frozen. Settle the attempt to credit it.");
      setPanel("result");
    });
  };
  const settle = () => {
    const current = state.current;
    if (!current || !terminal(current)) return;
    void operate(async (guard) => {
      if (live) {
        await settleWager(
          wallet!,
          current,
          (m) => {
            guard();
            setMessage(m);
          },
          guard
        );
        guard();
        await refresh();
        guard();
      } else if (!current.settled) {
        setPracticeBalance((b) => b + current.payout);
        accept({ ...current, settled: true });
      }
      setMessage("Settled. Your demo balance is updated.");
    });
  };
  const resume = () => {
    const current = state.current;
    if (!wallet || !current) return;
    void operate(async (guard) => {
      setStage(STEPS[2]);
      if (!current.delegated) {
        await delegateWager(wallet, current.index, guard);
        guard();
        await waitForEr(wallet, current.index);
        guard();
      }
      setStage(STEPS[3]);
      const authorized = await createGameSession(wallet, guard);
      guard();
      session.current = authorized.session;
      await authorizeWagerSession(wallet, current, authorized.session, guard);
      guard();
      setExpiry(authorized.session.expiresAt);
      await refresh();
      guard();
      setMessage("Session ready. Continue this same quest attempt.");
    });
  };
  const returnToDungeon = () => {
    if (!state.current?.settled) return;
    state.current = null;
    setAttempt(null);
    setPanel(null);
    if (live) localStorage.removeItem(journal);
    setMessage("Choose a new stake, then hunt any quest again.");
  };
  const pendingGate = attempt?.phase === "randomnessPending",
    frozen = !!attempt && terminal(attempt),
    active = attempt?.phase === "active";
  const canChangeMode = !attempt || attempt.settled;
  const canExplore =
    !!attempt &&
    attempt.phase === "active" &&
    attempt.questId === UNCHOSEN_QUEST;
  const interact = () => {
    if (!attempt || attempt.settled) {
      openStake();
      return;
    }
    if (terminal(attempt)) {
      setPanel("result");
      return;
    }
    if (attempt.phase === "randomnessPending") {
      setMessage("This request is pending. Wait for the same result.");
      return;
    }
    if (!nearby) {
      setMessage(
        "Your stake is reserved. Walk beside any quest to attempt it."
      );
      return;
    }
    if (live && expiry <= now) {
      setMessage("Authorize a gameplay session to continue hunting.");
      return;
    }
    setPanel("confirm");
  };
  const switchMode = (value: boolean) => {
    setPanel(null);
    setLive(value);
  };
  const fallback =
    live && (recovering || (pendingGate && now - attempt.requestedAt >= 60));
  const board = {
    ...INITIAL_DEMO,
    ...point,
    hp: 100,
    secondsLeft: 0,
    opened: 0,
    outcome:
      canExplore && !busy && !panel
        ? ("active" as const)
        : ("escaped" as const),
  };
  return (
    <section
      className="quest-game"
      aria-label="Six quest dungeon"
      aria-busy={busy}
    >
      <header className="q-toolbar">
        <span className="q-demo">DEMO CREDITS · NO CASH VALUE</span>
        <div className="q-tools">
          <button
            className="q-quiet"
            onClick={() => {
              const next = !sound;
              setSound(next);
              try {
                localStorage.setItem("loot-sound", next ? "on" : "off");
              } catch {}
            }}
            aria-pressed={sound}
          >
            Sound {sound ? "on" : "off"}
          </button>
          <button className="q-quiet" onClick={() => setPanel("quests")}>
            Quests & odds
          </button>
          <button className="q-quiet" onClick={() => setPanel("details")}>
            Details
          </button>
        </div>
      </header>
      <div className="q-amounts" aria-label="Demo amounts">
        <span>
          Balance <strong>{balance === null ? "—" : money(balance)}</strong>
        </span>
        <span>
          Stake <strong>{attempt ? money(attempt.stake) : "—"}</strong>
        </span>
        <span>
          {frozen ? "Frozen return" : "Outcome"}
          <strong>{frozen ? money(attempt.payout) : "Unrevealed"}</strong>
        </span>
        <span>
          Mode <strong>{live ? "Devnet VRF" : "Practice"}</strong>
        </span>
      </div>
      <div className="q-workspace">
        <div className="q-world">
          <div className="q-board">
            <PhaserBoard
              state={board}
              onMove={move}
              onInteract={interact}
              wagerMode
              questMode
              gateIndex={
                attempt && attempt.questId < 6 ? attempt.questId : selected
              }
              gatePhase={attempt?.phase ?? "exploring"}
            />
          </div>
          <p className="q-help">
            WASD / arrows · E to interact · walking is safe
          </p>
        </div>
        <aside className="q-actions">
          <div className="q-mode" role="group" aria-label="Play mode">
            <label>
              <input
                type="radio"
                name="quest-mode"
                checked={!live}
                disabled={busy || (!canChangeMode && !fallback)}
                onChange={() => switchMode(false)}
              />{" "}
              Practice
            </label>
            <label
              title={
                !questEnabled ? "V4 devnet verification is pending" : undefined
              }
            >
              <input
                type="radio"
                name="quest-mode"
                checked={live}
                disabled={!questEnabled || busy || !canChangeMode}
                onChange={() => switchMode(true)}
              />{" "}
              Devnet
            </label>
          </div>
          {live && <WalletMultiButton />}
          <div className="q-objective">
            <p className="q-eyebrow">
              {stage
                ? "Preparing attempt"
                : recovering
                ? "Recovery needed"
                : pendingGate
                ? "Randomness pending"
                : frozen
                ? "Quest result"
                : active
                ? "Hunt · any quest first"
                : "Choose a stake to enter"}
            </p>
            <h1>
              {stage ||
                (active
                  ? q.name
                  : frozen
                  ? attempt?.questId === UNCHOSEN_QUEST
                    ? "Hunt cancelled"
                    : q.name
                  : "Ready for the hunt?")}
            </h1>
            <p className="q-status" role="status" aria-live="polite">
              {message}
            </p>
          </div>
          {stage && (
            <ol className="q-stages">
              {STEPS.map((step, i) => (
                <li
                  key={step}
                  aria-current={stage === step ? "step" : undefined}
                >
                  {i + 1}. {step}
                </li>
              ))}
            </ol>
          )}
          {legacy ? (
            <>
              <p>Finish your unresolved V3 run before preparing V4 credits.</p>
              <Link className="q-button" href="/recovery">
                Recover V3 run
              </Link>
            </>
          ) : recovering ? (
            <button
              className="q-button"
              disabled={busy}
              onClick={() => void recover()}
            >
              Recover existing attempt
            </button>
          ) : stage ? (
            <p>Follow the current wallet approval. Keep this tab open.</p>
          ) : pendingGate ? (
            <>
              <button
                className="q-button"
                disabled={busy}
                onClick={() => void recover()}
              >
                Check existing request
              </button>
              <p className="q-small">
                {now - attempt.requestedAt >= 60
                  ? "The service is delayed. Your request stays pending; no reroll or automatic refund."
                  : "Waiting for the same request. No further stake is charged."}
              </p>
            </>
          ) : frozen ? (
            <button className="q-button" onClick={() => setPanel("result")}>
              View result
            </button>
          ) : active ? (
            <>
              <button
                className="q-button"
                disabled={busy}
                onClick={live && expiry <= now ? resume : interact}
              >
                {busy
                  ? "Confirming…"
                  : live && expiry <= now
                  ? "Authorize gameplay session"
                  : nearby
                  ? "Attempt quest"
                  : "Hunt · approach a quest"}
              </button>
              <button className="q-quiet" disabled={busy} onClick={cancel}>
                Cancel · full stake refund
              </button>
            </>
          ) : (
            <>
              <p className="q-small q-navigation-hint">
                {nearby
                  ? `You are beside ${nearby.name}.`
                  : `Choose your stake, then hunt any of the six quests.`}
              </p>
              <button
                className="q-button"
                disabled={busy || !!(live && (!wallet || !loaded))}
                onClick={openStake}
              >
                Choose stake
              </button>
            </>
          )}
          {fallback && (
            <>
              <button
                className="q-quiet"
                disabled={busy}
                onClick={() => switchMode(false)}
              >
                Switch to practice
              </button>
              <p className="q-small">
                Your devnet attempt remains unresolved. Return to Devnet to
                recover it. Practice has a separate balance.
              </p>
            </>
          )}
          {attempt && live && frozen && (
            <button className="q-quiet" onClick={() => setPanel("proof")}>
              Proof of roll
            </button>
          )}
          <Link className="q-recovery" href="/recovery">
            Earlier V3 runs · recovery
          </Link>
        </aside>
      </div>
      <QuestDialog
        open={panel === "quests"}
        onClose={() => setPanel(null)}
        title="Six quests · any order"
      >
        <p>
          Each attempt is independent. Failure returns zero. Returns include
          your stake. 95% theoretical return before cent rounding for every
          quest.
        </p>
        <div className="q-quest-list">
          {QUESTS.map((quest) => (
            <button
              key={quest.id}
              aria-pressed={selected === quest.id}
              onClick={() => {
                if (attempt && !canExplore && !attempt.settled) {
                  setMessage(
                    "Finish this attempt before selecting another quest."
                  );
                  setPanel(null);
                  return;
                }
                setSelected(quest.id);
                setMessage(
                  `Selected ${quest.name}. ${
                    attempt && !attempt.settled
                      ? "Walk to"
                      : "Stake first, then walk to"
                  } (${quest.x}, ${quest.y}).`
                );
                setPanel(null);
              }}
            >
              <b>
                {quest.id + 1} · {quest.name}
              </b>
              <span>
                {quest.odds} · {quest.multiplier}
              </span>
              <small>{quest.description}</small>
            </button>
          ))}
        </div>
      </QuestDialog>
      <QuestDialog
        open={panel === "stake"}
        onClose={() => setPanel(null)}
        title="Stake for the hunt"
      >
        <p className="q-demo">DEMO CREDITS · NO CASH VALUE</p>
        <p>
          Reserve one stake, then explore and choose any quest. You can review
          every quest’s odds in Quests &amp; odds. Failure returns zero.
        </p>
        <p>
          Balance: {balance === null ? "Loading…" : money(balance)}
          {live
            ? " · V4 has a separate one-time $100 demo allocation."
            : " · practice credits"}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            prepare();
          }}
        >
          <div className="q-presets">
            {["2.00", "5.00"].map((value) => (
              <button
                key={value}
                type="button"
                className="q-quiet"
                aria-pressed={amount === value}
                onClick={() => {
                  setAmount(value);
                  setAmountError("");
                }}
              >
                ${value}
              </button>
            ))}
          </div>
          <label htmlFor="quest-stake">Stake in demo credits</label>
          <input
            id="quest-stake"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!amountError}
            aria-describedby="q-stake-help q-stake-error"
          />
          <p id="q-stake-help">
            $1–$100 demo. Your quest and outcome are not chosen yet.
          </p>
          <p id="q-stake-error" role="status">
            {amountError}
          </p>
          <button type="submit" className="q-button" disabled={busy}>
            Prepare {live ? "devnet" : "practice"} attempt
          </button>
          <p className="q-small">
            Preparing reserves the stake. Explore next, then explicitly choose
            Attempt quest beside a guardian.{" "}
            {live
              ? "Wallet approvals include session funding of 0.002 devnet SOL plus fees."
              : "Practice uses browser randomness and creates no blockchain receipt."}
          </p>
        </form>
      </QuestDialog>
      <QuestDialog
        open={panel === "confirm"}
        onClose={() => setPanel(null)}
        title={`Attempt · ${q.name}`}
      >
        <p>
          Your reserved stake: {attempt ? money(attempt.stake) : "—"} demo
          credits.
        </p>
        <details>
          <summary>Review odds and possible return</summary>
          <p>
            {q.odds} success · {q.multiplier} total return, including stake.
            Failure returns zero.
          </p>
        </details>
        <p>
          This request uses your reserved stake. The result remains unknown
          until the roll resolves.
        </p>
        <button className="q-button" disabled={busy} onClick={attemptQuest}>
          Attempt quest
        </button>
      </QuestDialog>
      <QuestDialog
        open={panel === "result" && frozen}
        onClose={() => setPanel(null)}
        title={
          attempt?.settled
            ? attempt.phase === "succeeded"
              ? "CLEARED"
              : attempt.phase === "cancelled"
              ? "REFUNDED"
              : "LOST"
            : "Result frozen · settle to credit"
        }
      >
        {attempt && (
          <>
            <p>
              {attempt.questId === UNCHOSEN_QUEST
                ? "No quest was attempted. Your full stake is refundable."
                : `${q.name} · ${q.odds} success · ${q.multiplier} total return`}
            </p>
            <div className="q-result-amounts">
              <span>
                Stake<b>{money(attempt.stake)}</b>
              </span>
              <span>
                Total return<b>{money(attempt.payout)}</b>
              </span>
              <span>
                Net<b>{money(attempt.payout - attempt.stake)}</b>
              </span>
              <span>
                Balance<b>{balance === null ? "Loading…" : money(balance)}</b>
              </span>
            </div>
            <p className="q-demo">DEMO CREDITS · NO CASH VALUE</p>
            {attempt.settled ? (
              <button className="q-button" onClick={returnToDungeon}>
                Return to dungeon
              </button>
            ) : (
              <button
                className="q-button"
                disabled={busy || recovering}
                onClick={settle}
              >
                {busy ? "Settling…" : "Settle result"}
              </button>
            )}
            {live && (
              <>
                <button className="q-quiet" onClick={() => setPanel("proof")}>
                  Proof of roll
                </button>
                <a
                  href={`https://explorer.solana.com/address/${attempt.address.toBase58()}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect devnet receipt ↗
                </a>
              </>
            )}
            <p className="q-small">
              Every quest can fail. No outcome predicts your next attempt.
            </p>
          </>
        )}
      </QuestDialog>
      <QuestDialog
        open={panel === "proof"}
        onClose={() => setPanel(null)}
        title="Proof of roll"
      >
        {attempt && live ? (
          <QuestProof key={attempt.address.toBase58()} attempt={attempt} />
        ) : (
          <p>
            Practice uses browser randomness. There is no VRF proof or
            blockchain receipt.
          </p>
        )}
      </QuestDialog>
      <QuestDialog
        open={panel === "details"}
        onClose={() => setPanel(null)}
        title="Technical details"
      >
        <p>
          V4 independent quest rules ·{" "}
          {live ? "devnet VRF" : "practice, no VRF"}
        </p>
        <p>
          {questEnabled
            ? "Devnet V4 is enabled."
            : "Devnet V4 is disabled until deployment and live verification."}
        </p>
        {error && <p>Latest error: {error}</p>}
        <p>Attempt: {attempt?.address.toBase58() || "none"}</p>
        <p>ER: {attempt?.endpoint || "not delegated"}</p>
        <p>
          Phase: {attempt?.phase || "exploring"} · nonce: {attempt?.nonce ?? 0}
        </p>
        <p>
          Session expiry:{" "}
          {expiry ? new Date(expiry * 1000).toLocaleTimeString() : "none"}
        </p>
        <p>
          95% theoretical return before cent rounding. Demo credits cannot be
          redeemed.
        </p>
        <Link href="/recovery">Recover an earlier V3 run</Link>
      </QuestDialog>
    </section>
  );
}
