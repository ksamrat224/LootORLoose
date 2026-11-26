"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  buildGameSession,
  isGameSessionReady,
  base,
  submit,
  pendingSubmission,
  submissionStatus,
  clearPendingSubmission,
  PendingSubmission,
  type GameSession,
} from "@/lib/chain";
import {
  authorizeWagerSession,
  cancelWager,
  delegateWager,
  prepareHunt,
  rememberHuntSession,
  savedHuntSession,
  huntSessionRecord,
  endHuntSession,
  huntSessionControlEnabled,
  type HuntSessionRecord,
  huntEnabled,
  newDevnetHuntRules,
  huntV6Enabled,
  readPlayer,
  readWager,
  settleWager,
  terminal,
  wagerAction,
  waitForEr,
  type Wager,
} from "@/lib/hunt-chain";
import { watchHunt } from "@/lib/hunt-watch";
import { readPlayer as readV4Player } from "@/lib/quest-chain";
import { readPlayer as readV3Player } from "@/lib/wager-chain";
import { INITIAL_DEMO, isWalkable, distance, type Direction } from "./model";
import {
  QUESTS,
  UNCHOSEN_QUEST,
  STEP_DELTAS,
  approachPath,
  practiceBucket,
  huntReward,
  rewardRules,
  supportedHuntRules,
  PRACTICE_RULES_VERSION,
} from "./hunt-rules";
import { money, parseStake } from "./wager-rules";
import { PhaserBoard } from "./PhaserBoard";
import { QuestDialog } from "./QuestDialog";
import { HuntProof } from "./HuntProof";

type Panel =
  | "session"
  | "quests"
  | "rules"
  | "reveal"
  | "stake"
  | "confirm"
  | "proof"
  | "details"
  | "result"
  | null;
const STEPS = [
  "Prepare demo credits",
  "Reserve hunt stake",
  "Connect the dungeon",
  "Authorize gameplay",
];
export function HuntGame() {
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
  const [legacy, setLegacy] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState(
    "Choose your stake first, then hunt three of the six guardians.",
  );
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [expiry, setExpiry] = useState(0);
  const [hasSessionKey, setHasSessionKey] = useState(false);
  const [sessionRecord, setSessionRecord] = useState<HuntSessionRecord | null>(
    null,
  );
  const [sound, setSound] = useState(false);
  const practiceCredits = useRef(10000);
  const revealedCount = useRef(0);
  const state = useRef<Wager | null>(null),
    position = useRef(point),
    session = useRef<GameSession | null>(null);
  const epoch = useRef(0),
    locked = useRef(false),
    pending = useRef<unknown>(null),
    generationKey = useRef("");
  const identity = `${live}:${walletKey}`;

  const journal = `loot-or-lose:hunt-v5:${walletKey}`;
  const balance = live ? liveBalance : practiceBalance;
  const rulesVersion =
    attempt?.rulesVersion ??
    (live ? newDevnetHuntRules() : PRACTICE_RULES_VERSION);
  const rules = rewardRules(rulesVersion);
  const accept = useCallback((value: Wager) => {
    const previous = state.current;
    if (
      previous?.address.equals(value.address) &&
      (previous.nonce > value.nonce || (previous.settled && !value.settled))
    )
      return;
    state.current = value;
    setAttempt(value);
    if (value.address.equals(PublicKey.default)) {
      try {
        sessionStorage.setItem(
          "loot-hunt-v5-practice",
          JSON.stringify({
            attempt: value,
            balance: practiceCredits.current,
            point: position.current,
          }),
        );
      } catch {}
    }
    if (value.questId < QUESTS.length && value.phase === "randomnessPending")
      setSelected(value.questId);
    if (!previous || value.phase !== "active") {
      position.current = { x: value.x, y: value.y };
      setPoint(position.current);
    }
  }, []);
  const creditPractice = (delta: number) => {
    practiceCredits.current += delta;
    setPracticeBalance(practiceCredits.current);
  };
  const finishPractice = (current: Wager) => {
    const bucket = current.practiceBuckets![current.revealCount];
    const reward = huntReward(current.stake, bucket, current.rulesVersion);
    const count = current.revealCount + 1;
    accept({
      ...current,
      phase: count === 3 ? "complete" : "active",
      openedMask: current.openedMask | (1 << current.questId),
      revealCount: count,
      reveals: [
        ...current.reveals,
        { questId: current.questId, randomness: [], bucket, reward },
      ],
      payout: current.payout + reward,
      nonce: current.nonce + 1,
    });
    setMessage(
      count === 3
        ? "All three quests opened. Collect your loot."
        : "Loot revealed. Hunt a different guardian next.",
    );
    setPanel(count === 3 ? "result" : "reveal");
  };
  const guardFor = () => {
    const stamp = epoch.current,
      key = identity;
    return () => {
      if (epoch.current !== stamp || generationKey.current !== key)
        throw new Error("Wallet or game context changed");
    };
  };
  const refresh = useCallback(async () => {
    if (!wallet || !huntEnabled) return;
    const stamp = epoch.current;
    const [old, oldQuest] = await Promise.all([
      readV3Player(wallet),
      readV4Player(wallet),
    ]);
    if (stamp !== epoch.current) return;
    setLegacy(old?.active ? 3 : oldQuest?.active ? 4 : 0);
    if (old?.active || oldQuest?.active) {
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
            : "Existing attempt recovered. Authorize gameplay to continue it.",
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
    revealedCount.current = 0;
    const timeout = setTimeout(() => {
      setAttempt(null);
      setPanel(null);
      setBusy(false);
      setStage("");
      setRecovering(false);
      setError("");
      setLegacy(0);
      setLoaded(!live);
      setExpiry(0);
      setSessionRecord(null);
      setHasSessionKey(false);
      setLiveBalance(null);
      setMessage(
        live
          ? "Connect a wallet to prepare a hunt."
          : "Choose your stake first, then explore and hunt three different quests.",
      );
      if (!live) {
        try {
          const raw = sessionStorage.getItem("loot-hunt-v5-practice");
          if (raw) {
            const saved = JSON.parse(raw);
            if (Number.isSafeInteger(saved.balance) && saved.balance >= 0) {
              practiceCredits.current = saved.balance;
              setPracticeBalance(saved.balance);
              if (
                supportedHuntRules(saved.attempt?.rulesVersion) &&
                saved.attempt.practiceBuckets?.length === 3
              ) {
                const value = {
                  ...saved.attempt,
                  address: PublicKey.default,
                } as Wager;
                accept(value);
                if (
                  saved.point &&
                  isWalkable(saved.point.x, saved.point.y) &&
                  value.phase === "active"
                ) {
                  position.current = saved.point;
                  setPoint(saved.point);
                }
                setMessage(
                  "Practice hunt restored. Your stake and revealed loot are retained.",
                );
                if (value.phase === "randomnessPending") {
                  const stamp = epoch.current;
                  setTimeout(() => {
                    if (
                      stamp === epoch.current &&
                      state.current?.phase === "randomnessPending"
                    )
                      finishPractice(value);
                  }, 900);
                }
              }
            }
          }
        } catch {}
      }
      if (live && wallet && huntEnabled) {
        try {
          pending.current = pendingSubmission(wallet.publicKey);
          if (pending.current) {
            setRecovering(true);
            setMessage(
              "An earlier submission needs recovery. No new attempt will be created.",
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
            "Could not read your devnet state. Recover before preparing another attempt.",
          );
        });
      }
    }, 0);
    return () => clearTimeout(timeout);
    // Wallet identity and mode define a disposable context; refresh reads current public recovery metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, walletKey]);
  const watchedIndex = attempt?.index;
  const watchedSettled = attempt?.settled;
  useEffect(() => {
    if (!live || !wallet || watchedIndex === undefined || watchedSettled)
      return;
    const stamp = epoch.current;
    return watchHunt(
      wallet,
      watchedIndex,
      (value) => {
        if (epoch.current === stamp) accept(value);
      },
      () => {
        if (epoch.current === stamp)
          setMessage("Connection delayed. Your hunt is retained; use Recover.");
      },
    );
  }, [live, wallet, watchedIndex, watchedSettled, accept]);
  useEffect(() => {
    if (!live || !wallet || !watchedSettled) return;
    const stamp = epoch.current;
    void readPlayer(wallet)
      .then((player) => {
        if (epoch.current === stamp && player)
          setLiveBalance(player.balance.toNumber());
      })
      .catch(() => {});
  }, [live, wallet, watchedSettled]);
  useEffect(() => {
    if (!live || !watchedSettled || recovering || busy) return;
    const timer = setTimeout(() => setPanel("result"), 0);
    return () => clearTimeout(timer);
  }, [live, watchedSettled, recovering, busy]);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
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
      !["complete", "active"].includes(current)
    )
      return;
    try {
      const audio = new AudioContext(),
        osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.frequency.value = 660;
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
  useEffect(() => {
    const count = attempt?.revealCount ?? 0;
    const previous = revealedCount.current;
    revealedCount.current = count;
    if (
      !live ||
      !attempt ||
      attempt.phase === "randomnessPending" ||
      count <= previous
    )
      return;
    const timer = setTimeout(() => {
      setMessage(
        count === 3
          ? "All three quests opened. Collect your loot."
          : "Loot revealed. Hunt a different guardian next.",
      );
      setPanel(count === 3 ? "result" : "reveal");
    }, 0);
    return () => clearTimeout(timer);
  }, [attempt, live]);
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
          : "The action needs a state check. Recover your existing attempt to continue.",
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
          "The same transaction is still pending. No new attempt has been submitted.",
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
          "Recovery could not reach devnet. Try again when the connection returns.",
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
      recovering ||
      legacy
    )
      return;
    const [dx, dy] = STEP_DELTAS[direction],
      next = { x: position.current.x + dx, y: position.current.y + dy };
    if (isWalkable(next.x, next.y)) {
      position.current = next;
      setPoint(next);
      if (!live && state.current) {
        try {
          sessionStorage.setItem(
            "loot-hunt-v5-practice",
            JSON.stringify({
              attempt: state.current,
              balance: practiceCredits.current,
              point: next,
            }),
          );
        } catch {}
      }
    }
  };
  const nearby = QUESTS.find((q) => distance(point, q) <= 1);
  const q =
    QUESTS[
      attempt?.phase === "randomnessPending" && attempt.questId < 6
        ? attempt.questId
        : nearby?.id ?? selected
    ];
  const openStake = () => {
    if (locked.current || panel || recovering || legacy) return;
    if (state.current) {
      if (terminal(state.current)) setPanel("result");
      setMessage(
        "Finish this hunt and return to the dungeon before choosing another stake.",
      );
      return;
    }
    if (live && (!wallet || !loaded || legacy)) {
      setMessage(
        legacy
          ? "Recover your unresolved V3/V4 run first."
          : "Connect your wallet and wait for the ledger check first.",
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
        creditPractice(-stake);
        accept({
          address: PublicKey.default,
          index: 0,
          stake,
          rulesVersion: PRACTICE_RULES_VERSION,
          questId: UNCHOSEN_QUEST,
          phase: "active",
          ...position.current,
          nonce: 0,
          requestNonce: 0,
          requestedAt: 0,
          payout: 0,
          delegated: false,
          settled: false,
          openedMask: 0,
          revealCount: 0,
          reveals: [],
          practiceBuckets: [
            practiceBucket(),
            practiceBucket(),
            practiceBucket(),
          ],
        });
        setMessage("Stake ready. Hunt three different guardians.");
        return;
      }
      if (!wallet) throw new Error("Connect a devnet wallet");
      const prepared = await prepareHunt(
        wallet,
        stake,
        (text) => {
          setStage(text);
          setMessage(text);
        },
        guard,
        (preparedSession) => {
          session.current = preparedSession;
          setHasSessionKey(false);
          setExpiry(0);
        },
      );
      guard();
      localStorage.setItem(journal, String(prepared.index));
      session.current = prepared.session;
      setHasSessionKey(true);
      setSessionRecord(savedHuntSession(wallet, prepared.index));
      setExpiry(prepared.session.expiresAt);
      await refresh();
      guard();
      setMessage(
        "Stake ready. Explore and hunt three different quests; the choice is yours.",
      );
    });
  };
  const attemptQuest = () => {
    const current = state.current;
    if (!current || current.phase !== "active") return;
    const target = QUESTS.find(
      (quest) => distance(position.current, quest) <= 1,
    );
    if (!target) {
      setMessage(
        "Your stake is reserved. Walk beside an unopened quest to reveal its loot.",
      );
      return;
    }
    if (
      live &&
      (!hasSessionKey ||
        !session.current ||
        session.current.expiresAt <= Date.now() / 1000)
    ) {
      setMessage("Authorize a gameplay session before attempting a quest.");
      return;
    }
    if (current.openedMask & (1 << target.id)) {
      setMessage("This quest is already opened. Hunt another guardian.");
      return;
    }
    const path = approachPath(position.current, { x: current.x, y: current.y });
    setPanel(null);
    void operate(async (guard) => {
      if (!live) {
        accept({
          ...current,
          ...position.current,
          questId: target.id,
          phase: "randomnessPending",
          requestedAt: Math.floor(Date.now() / 1000),
          nonce: current.nonce + 1,
          requestNonce: current.nonce + 1,
        });
        setMessage("Practice roll in progress · browser randomness.");
        await new Promise((r) => setTimeout(r, 900));
        guard();
        finishPractice(state.current!);
        return;
      }
      await wagerAction(
        wallet!,
        current,
        session.current!,
        "risk",
        target.id,
        path,
        guard,
      );
      guard();
      // Confirmed request acceptance is newer than an ER read that briefly lags it.
      // Hold this nonce/phase until a callback or recovery observes newer state.
      accept({
        ...current,
        ...position.current,
        questId: target.id,
        phase: "randomnessPending",
        nonce: current.nonce + 1,
        requestNonce: current.nonce + 1,
        requestedAt: Math.floor(Date.now() / 1000),
      });
      await refresh();
      guard();
      setMessage(
        "One VRF request is pending. This attempt cannot be rerolled.",
      );
    });
  };
  const cancel = () => {
    const current = state.current;
    if (
      !current ||
      current.phase !== "active" ||
      current.revealCount > 0 ||
      current.requestNonce > 0
    )
      return;
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
          guard,
        );
        guard();
        await refresh();
        guard();
      } else if (!current.settled) {
        creditPractice(current.payout);
        accept({ ...current, settled: true });
      }
      setMessage("Settled. Your demo balance is updated.");
    });
  };
  const resume = () => {
    const current = state.current;
    if (!wallet || !current) return;
    if (savedHuntSession(wallet, current.index)?.ending) {
      setPanel("session");
      setMessage(
        "Finish ending the previous session before authorizing another.",
      );
      return;
    }
    void operate(async (guard) => {
      setStage(STEPS[2]);
      if (!current.delegated) {
        await delegateWager(wallet, current.index, guard);
        guard();
        await waitForEr(wallet, current.index);
        guard();
      }
      setStage(STEPS[3]);
      let candidate = session.current;
      let createdNow = false;
      if (!candidate || !(await isGameSessionReady(wallet, candidate))) {
        guard();
        const built = await buildGameSession(wallet);
        candidate = built.session;
        guard();
        session.current = candidate;
        setHasSessionKey(false);
        setExpiry(0);
        setSessionRecord(rememberHuntSession(wallet, current.index, candidate));
        setStage("Authorize session · base approval 1/2");
        await submit(
          base,
          wallet,
          built.transaction,
          [candidate.signer],
          guard,
        );
        createdNow = true;
      }
      guard();
      const latest = await readWager(wallet, current.index);
      guard();
      if (!latest?.sessionSigner?.equals(candidate.signer.publicKey)) {
        setStage(
          createdNow
            ? "Bind this funded session · ER approval 2/2"
            : "Reuse funded session · remaining approval 1/1",
        );
        await authorizeWagerSession(wallet, current, candidate, guard);
      }
      guard();
      session.current = candidate;
      setHasSessionKey(true);
      setExpiry(candidate.expiresAt);
      await refresh();
      guard();
      setMessage("Session ready. Continue this same quest attempt.");
    });
  };
  const showSession = () => {
    setPanel("session");
    if (wallet && state.current) {
      const guard = guardFor();
      void huntSessionRecord(wallet, state.current)
        .then((record) => {
          guard();
          setSessionRecord(record);
        })
        .catch(() => {});
    }
  };
  const endSession = () => {
    const current = state.current;
    if (!wallet || !current) return;
    // Stop local signing before any RPC or wallet request, including rejected approvals.
    session.current = null;
    setHasSessionKey(false);
    setExpiry(0);
    void operate(async (guard) => {
      const existing = pendingSubmission(wallet.publicKey);
      if (existing && (await submissionStatus(existing)) === "pending")
        throw existing;
      guard();
      await endHuntSession(
        wallet,
        current,
        (text) => {
          setStage(text);
          setMessage(text);
        },
        guard,
      );
      guard();
      setSessionRecord(null);
      await refresh();
      guard();
      setMessage(
        "Gameplay session ended. Accepted reveals still finish; authorize again to continue hunting.",
      );
    });
  };
  const returnToDungeon = () => {
    if (!state.current?.settled) return;
    state.current = null;
    setAttempt(null);
    setPanel(null);
    if (live) localStorage.removeItem(journal);
    setMessage("Choose a new stake, then hunt three different quests again.");
    if (!live) {
      try {
        sessionStorage.setItem(
          "loot-hunt-v5-practice",
          JSON.stringify({
            attempt: null,
            balance: practiceCredits.current,
            point: position.current,
          }),
        );
      } catch {}
    }
  };
  const pendingGate = attempt?.phase === "randomnessPending",
    frozen = !!attempt && terminal(attempt),
    active = attempt?.phase === "active";
  const canChangeMode = !attempt || attempt.settled;
  const canExplore = !!attempt && attempt.phase === "active";
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
        "Your stake is reserved. Walk beside an unopened quest to reveal its loot.",
      );
      return;
    }
    if (live && expiry <= now) {
      setMessage("Authorize a gameplay session to continue hunting.");
      return;
    }
    if (attempt.openedMask & (1 << nearby.id)) {
      setMessage("Already opened. Choose a different quest.");
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
    opened: attempt?.openedMask ?? 0,
    ...point,
    hp: 100,
    secondsLeft: 0,

    outcome:
      canExplore && !busy && !panel
        ? ("active" as const)
        : ("escaped" as const),
  };
  return (
    <section
      className="quest-game hunt-game"
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
            Quests
          </button>
          <button
            className="q-quiet"
            onClick={() => setPanel("rules")}
            aria-label="Reward rules"
          >
            Rules
          </button>
          <button className="q-quiet" onClick={() => setPanel("details")}>
            Details
          </button>
          {live && (
            <button className="q-quiet" onClick={showSession}>
              Session
            </button>
          )}
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
          Loot found
          <strong>
            {attempt && (attempt.revealCount > 0 || frozen)
              ? money(attempt.payout)
              : "Unrevealed"}
          </strong>
        </span>
        <span>
          Quests opened <strong>{attempt?.revealCount ?? 0}/3</strong>
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
              gateIndex={pendingGate ? attempt.questId : nearby?.id ?? selected}
              gatePhase={attempt?.phase ?? "exploring"}
            />
          </div>
          <p className="q-help">
            WASD / arrows · E to interact · walking is safe
          </p>
        </div>
        <aside className="q-actions" aria-label="Hunt controls">
          <div className="q-connection">
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
                  !huntEnabled ? "V5 devnet verification is pending" : undefined
                }
              >
                <input
                  type="radio"
                  name="quest-mode"
                  checked={live}
                  disabled={!huntEnabled || busy || !canChangeMode}
                  onChange={() => switchMode(true)}
                />{" "}
                Devnet
              </label>
            </div>
            {live && <WalletMultiButton />}
          </div>
          <div className="q-hunt-controls">
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
                  ? "Hunt · open three quests"
                  : "Choose a stake to enter"}
              </p>
              <h1>
                {stage ||
                  (active
                    ? q.name
                    : frozen
                    ? attempt?.phase === "cancelled"
                      ? "Hunt cancelled"
                      : "Hunt complete"
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
                <p>
                  Finish your unresolved V{legacy} run before preparing V5
                  credits.
                </p>
                <Link
                  className="q-button"
                  href={legacy === 4 ? "/recovery/quests" : "/recovery"}
                >
                  Recover V{legacy} run
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
                {attempt.settled
                  ? "View result"
                  : attempt.phase === "cancelled"
                  ? "Collect refund"
                  : "Collect loot"}
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
                    ? attempt.openedMask & (1 << nearby.id)
                      ? "Quest already opened"
                      : "Open quest"
                    : "Explore"}
                </button>
                {attempt.revealCount === 0 && attempt.requestNonce === 0 && (
                  <button className="q-quiet" disabled={busy} onClick={cancel}>
                    Cancel hunt · full refund
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="q-small q-navigation-hint">
                  {nearby
                    ? `You are beside ${nearby.name}.`
                    : `Choose your stake, then hunt three of the six quests.`}
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
            {attempt && live && attempt.revealCount > 0 && (
              <button className="q-quiet" onClick={() => setPanel("proof")}>
                Proof of roll
              </button>
            )}
          </div>
          <Link className="q-recovery" href="/recovery">
            Earlier V3 runs · recovery
          </Link>
        </aside>
      </div>
      <QuestDialog
        open={panel === "session"}
        onClose={() => setPanel(null)}
        title="Gameplay session"
      >
        <p>
          Status:{" "}
          {sessionRecord?.ending
            ? "Hunt block or token closure needs recovery"
            : hasSessionKey && expiry > now
            ? "Ready on this device"
            : sessionRecord
            ? "No usable key on this device"
            : "Not authorized"}
        </p>
        <p>
          Expires:{" "}
          {sessionRecord?.expiresAt || expiry
            ? new Date(
                (sessionRecord?.expiresAt || expiry) * 1000,
              ).toLocaleTimeString()
            : "No active session"}
        </p>
        <p>
          Permits opening quests on this hunt only. Stakes, cancellation and
          collection require your wallet.
        </p>
        <p>
          Each new session receives 0.002 devnet SOL, plus transaction fees and
          account rent. Keys stay in memory; reloading requires authorization
          again.
        </p>
        <button
          className="q-button"
          onClick={resume}
          disabled={
            busy ||
            recovering ||
            !attempt ||
            attempt.phase !== "active" ||
            attempt.settled
          }
        >
          Authorize session
        </button>
        {huntSessionControlEnabled ? (
          <button
            className="q-quiet"
            onClick={endSession}
            disabled={
              busy ||
              recovering ||
              !attempt ||
              (!sessionRecord &&
                (!attempt.sessionSigner ||
                  attempt.sessionSigner.equals(PublicKey.default)))
            }
          >
            End gameplay session
          </button>
        ) : (
          <p>
            Session-ending controls await verified deployment. Existing sessions
            expire after four minutes.
          </p>
        )}
        <p>
          Ending a session blocks further actions; an accepted randomness
          request still completes. Hunt-key removal and Solana-token closure are
          confirmed separately.
        </p>
      </QuestDialog>
      <QuestDialog
        open={panel === "quests"}
        onClose={() => setPanel(null)}
        title="Six quests · any order"
      >
        <p>
          Hunt any three different guardians. Each holds a hidden reward from
          the same pool.
        </p>
        <div className="q-quest-list">
          {QUESTS.map((quest) => (
            <button
              key={quest.id}
              aria-pressed={selected === quest.id}
              disabled={!!attempt && !!(attempt.openedMask & (1 << quest.id))}
              onClick={() => {
                if (attempt && !canExplore && !attempt.settled) {
                  setMessage(
                    "Finish this attempt before selecting another quest.",
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
                  } (${quest.x}, ${quest.y}).`,
                );
                setPanel(null);
              }}
            >
              <b>
                {quest.id + 1} · {quest.name}
              </b>
              <span>
                {attempt && attempt.openedMask & (1 << quest.id)
                  ? "Opened"
                  : `Chamber (${quest.x}, ${quest.y})`}
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
          Reserve one stake, then hunt three different quests. Each reveals
          hidden loot. Rewards add together; collect after all three.
        </p>
        <p>
          Balance: {balance === null ? "Loading…" : money(balance)}
          {live
            ? " · V5 and V6 hunts share one one-time $100 demo allocation."
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
            Start hunt
          </button>
          <p className="q-small">
            Preparing reserves the stake. Explore next, then explicitly choose
            Open quest beside a guardian.{" "}
            {live
              ? "Wallet approvals include session funding of 0.002 devnet SOL plus fees and account rent."
              : "Practice uses browser randomness and creates no blockchain receipt."}
          </p>
        </form>
      </QuestDialog>
      <QuestDialog
        open={panel === "confirm"}
        onClose={() => setPanel(null)}
        title={`Open · ${q.name}`}
      >
        <p>
          Your reserved stake: {attempt ? money(attempt.stake) : "—"} demo
          credits.
        </p>
        <p>
          Reveal one of your three quests. No further stake is charged. A zero
          reward never removes loot you have already found.
        </p>
        <button className="q-button" disabled={busy} onClick={attemptQuest}>
          Open quest
        </button>
      </QuestDialog>
      <QuestDialog
        open={panel === "result" && frozen}
        onClose={() => setPanel(null)}
        title={
          attempt?.settled
            ? attempt.phase === "cancelled"
              ? "REFUNDED"
              : "LOOT COLLECTED"
            : "Loot frozen · collect to credit"
        }
      >
        {attempt && (
          <>
            <p>
              {attempt.phase === "cancelled"
                ? "No quest was opened. Your full stake is refundable."
                : "Three discoveries. Your final loot is ready."}
            </p>
            <ol>
              {attempt.reveals.map((r, i) => (
                <li key={i}>
                  {QUESTS[r.questId].name}:{" "}
                  {r.reward ? money(r.reward) : "No loot found"}
                </li>
              ))}
            </ol>
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
            <div className="q-result-actions">
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
                  {busy
                    ? "Collecting…"
                    : attempt.phase === "cancelled"
                    ? "Collect refund"
                    : "Collect loot"}
                </button>
              )}
              {live && (
                <div className="q-result-secondary">
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
                </div>
              )}
            </div>
            <p className="q-small">
              Rewards include the stake contribution. Your stake is not returned
              a second time.
            </p>
          </>
        )}
      </QuestDialog>
      <QuestDialog
        open={panel === "rules"}
        onClose={() => setPanel(null)}
        title="Reward rules"
      >
        <p>
          Rules V{rulesVersion}. All six quests share this prize pool. Each of
          your three reveals is an independent draw, based on your original
          stake.
        </p>
        <table>
          <thead>
            <tr>
              <th>Reward</th>
              <th>Probability</th>
            </tr>
          </thead>
          <tbody>
            {rules.rewards.map((r) => (
              <tr key={r.limit}>
                <td>{r.label} of stake</td>
                <td>{r.chance}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Rewards are rounded down to cents and added together. Three reveals
          average {rules.averageReturn} of the stake before rounding. Rewards
          include the stake contribution. Collect after all three; zero rewards
          do not remove earlier loot. Cancel for a full refund only before the
          first request. These are theoretical averages, not guarantees.
          Repeated play can reduce your demo credits. Demo credits have no cash
          value.
        </p>
      </QuestDialog>
      <QuestDialog
        open={panel === "reveal"}
        onClose={() => setPanel(null)}
        title="Quest revealed"
      >
        {attempt && attempt.reveals.length > 0 && (
          <>
            <p>{QUESTS[attempt.reveals.at(-1)!.questId].name}</p>
            <h2>
              {attempt.reveals.at(-1)!.reward
                ? money(attempt.reveals.at(-1)!.reward)
                : "No loot found"}
            </h2>
            <p>
              Quests opened: {attempt.revealCount}/3 · Loot found:{" "}
              {money(attempt.payout)} demo credits. Earlier loot is safe.
            </p>
          </>
        )}
        <button className="q-button" onClick={() => setPanel(null)}>
          Continue hunt
        </button>
      </QuestDialog>
      <QuestDialog
        open={panel === "proof"}
        onClose={() => setPanel(null)}
        title="Proof of roll"
      >
        {attempt && live ? (
          <HuntProof key={attempt.address.toBase58()} attempt={attempt} />
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
          V{rulesVersion} three-reveal hunt rules ·{" "}
          {live ? "devnet VRF" : "practice, no VRF"}
        </p>
        <p>
          {huntEnabled
            ? "Devnet V5 is enabled."
            : "Devnet V5 is disabled until deployment and live verification."}
        </p>
        <p>
          {huntV6Enabled
            ? "New devnet hunts use V6 rewards."
            : "V6 devnet creation is disabled pending deployment and live verification."}
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
          {rules.averageReturn} theoretical return before cent rounding. Demo
          credits cannot be redeemed.
        </p>
        <Link href="/recovery">Recover an earlier V3 run</Link>
        <Link href="/recovery/quests">Recover an earlier V4 quest</Link>
      </QuestDialog>
    </section>
  );
}
