"use client";

import { useCallback, useEffect, useState } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { activateRun, advanceRun, createRun, delegateRun, expireRun, finalizeRun, findLatestRun, isConfigured, openChest, readBaseReceipt, readRun, requestExtraction, type RunSnapshot } from "@/lib/chain";
import { CHESTS, EXIT, INITIAL_DEMO, distance, isWalkable, pendingGold, type DemoState, type Direction } from "./model";
import { PhaserBoard } from "./PhaserBoard";

function view(state: RunSnapshot, now: number): DemoState {
  const outcome = state.phase === "active" ? "active" : state.phase === "dead" ? "dead" : state.phase === "extracted" ? "escaped" : "timed_out";
  return { ...INITIAL_DEMO, x: state.x, y: state.y, hp: state.hp, opened: state.chestMask, secondsLeft: Math.max(0, state.deadline - now), outcome, message: `Confirmed ${state.source.toUpperCase()} state: ${state.phase}.` };
}

export function OnchainGame() {
  const wallet = useAnchorWallet();
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [receipt, setReceipt] = useState<RunSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Connect a devnet wallet to begin.");
  const [signature, setSignature] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const storageKey = wallet ? `loot-or-lose:run:${wallet.publicKey.toBase58()}` : null;
  const refresh = useCallback(async (index: number) => {
    if (!wallet) return;
    const [latest, baseState] = await Promise.all([readRun(wallet, index), readBaseReceipt(wallet, index)]);
    if (latest) setRun(latest);
    setReceipt(baseState?.phase === "extracted" || baseState?.phase === "dead" || baseState?.phase === "timedOut" ? baseState : null);
    if (latest) setMessage(`${latest.phase} · ${latest.source === "er" ? "ER action state" : "Solana base state"}`);
  }, [wallet]);
  useEffect(() => {
    if (!storageKey) return;
    const saved = window.localStorage.getItem(storageKey);
    const timer = window.setTimeout(() => {
      if (saved && /^\d+$/.test(saved)) { refresh(Number(saved)).catch((error) => setMessage(`Recovery check: ${String(error)}`)); }
      else if (wallet && isConfigured) { findLatestRun(wallet).then((latest) => { if (latest) { window.localStorage.setItem(storageKey, String(latest.index)); refresh(latest.index); } }).catch((error) => setMessage(`Latest-run check: ${String(error)}`)); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, wallet, refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => window.clearInterval(timer); }, []);
  const perform = useCallback(async (operation: () => Promise<string | void>, success: string) => {
    if (!wallet || !run || busy) return;
    setBusy(true);
    try {
      const tx = await operation();
      if (tx) setSignature(tx);
      await refresh(run.index);
      setMessage(success);
    } catch (error) {
      setRun(run);
      setMessage(`Action uncertain or rejected: ${String(error)}. Checking current state before retry.`);
      try { await refresh(run.index); } catch { /* Preserve the original diagnostic. */ }
    } finally { setBusy(false); }
  }, [wallet, run, busy, refresh]);
  const start = async () => {
    if (!wallet || busy) return;
    setBusy(true);
    try {
      const created = await createRun(wallet);
      window.localStorage.setItem(`loot-or-lose:run:${wallet.publicKey.toBase58()}`, String(created.index));
      setRun({ address: created.address, index: created.index, phase: "created", x: 1, y: 1, hp: 100, deadline: 0, chestMask: 0, nonce: 0, finalScore: 0, source: "base", delegated: false });
      setSignature(created.signatures.at(-1) || null);
      setMessage("Run created on Solana devnet. Delegate it to the ER to start the timer.");
    } catch (error) { setMessage(`Run creation failed or is uncertain: ${String(error)}. Refresh status before retrying.`); }
    finally { setBusy(false); }
  };
  const delegate = () => perform(async () => {
    if (!wallet || !run) return;
    const tx = await delegateRun(wallet, run.index);
    await refresh(run.index);
    return tx;
  }, "Delegation submitted. Activate the run when the router reports an ER endpoint.");
  const activate = () => perform(() => activateRun(wallet!, run!.index), "ER run activated. The 180-second timer has started.");
  const move = (direction: Direction) => {
    if (!run || run.phase !== "active" || busy) return;
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][direction];
    const x = run.x + dx, y = run.y + dy;
    if (!isWalkable(x, y)) { setMessage("A wall blocks your path."); return; }
    setRun({ ...run, x, y });
    setMessage("Move pending wallet and ER confirmation…");
    perform(() => advanceRun(wallet!, run, [direction]), "Checkpoint confirmed on ER.");
  };
  const interact = () => {
    if (!run) return;
    const id = CHESTS.findIndex((chest, index) => !(run.chestMask & (1 << index)) && distance(run, chest) <= 1);
    if (id < 0) { setMessage("Move next to an unopened chest."); return; }
    perform(() => openChest(wallet!, run, id), "Chest opened on ER. Loot remains pending until confirmed extraction.");
  };
  const extract = () => perform(() => requestExtraction(wallet!, run!), "Extraction request frozen on ER. Finalize to commit it to Solana.");
  const finalize = () => perform(async () => {
    const result = await finalizeRun(wallet!, run!.index);
    if (result.commitSignature) setSignature(result.commitSignature);
    return result.erSignature;
  }, "Commit requested. Check the base-layer receipt before claiming extraction.");
  const shown = run ? view(run, now) : null;
  const secondsLeft = run && run.deadline ? Math.max(0, run.deadline - now) : 180;
  const link = signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : null;
  return <section className="onchain">
    <div className="section-title"><div><p className="eyebrow">Solana devnet / MagicBlock ER</p><h1>Onchain run</h1></div><span className="demo-label">DEVNET</span></div>
    <div className="card chain-status"><WalletMultiButton /><p role="status" aria-live="polite">{message}</p><p className="muted">Wallet: {wallet?.publicKey.toBase58() || "disconnected"} · Network: devnet</p><p className="muted">Program: {isConfigured ? "configured" : "not deployed/configured"}</p>{run && <><p className="muted">Run: {run.address.toBase58()} · Phase: {run.phase} · Source: {run.source}</p><p className="muted">ER: {run.endpoint || (run.delegated ? "router resolving" : "not delegated")}</p></>}{link && <a href={link} target="_blank" rel="noreferrer">Latest transaction ↗</a>}</div>
    {!isConfigured && <p className="message">Onchain play is disabled until the compiled program is deployed to devnet and its address is set in app/.env.local. The local demo remains playable.</p>}
    {wallet && isConfigured && !run && <div className="onchain-actions"><button className="button primary" disabled={busy} onClick={start}>Create devnet run</button><button className="button secondary" disabled={busy} onClick={() => findLatestRun(wallet).then((latest) => latest ? refresh(latest.index) : setMessage("No prior run found for this wallet.")).catch((error) => setMessage(String(error)))}>Recover latest run</button></div>}
    {wallet && run?.phase === "created" && !run.delegated && <button className="button primary" disabled={busy} onClick={delegate}>Delegate run to ER</button>}
    {wallet && run?.phase === "created" && run.delegated && <button className="button primary" disabled={busy} onClick={activate}>Activate 3-minute run</button>}
    {shown && <div className="run-layout"><div className="game-area"><div className="board-frame"><PhaserBoard state={shown} onMove={move} onInteract={interact} /></div><p className="message">WASD or arrows to submit one signed step; E opens a nearby chest. Wait for confirmation before the next move.</p></div><aside className="sidebar"><div className="card"><p className="eyebrow">Confirmed state</p><div className="stat"><span>HP</span><strong>{run?.hp}/100</strong></div><div className="stat"><span>Time</span><strong>{Math.floor(secondsLeft / 60).toString().padStart(2, "0")}:{(secondsLeft % 60).toString().padStart(2, "0")}</strong></div><div className="stat"><span>Pending loot</span><strong>{pendingGold(run?.chestMask || 0)} demo gold</strong></div></div>{run?.phase === "active" && secondsLeft === 0 && <button className="button secondary full" disabled={busy} onClick={() => perform(() => expireRun(wallet!, run.index), "Run expired on ER. Commit failure result to Solana.")}>Mark timed out</button>}{run?.phase === "active" && run.x === EXIT.x && run.y === EXIT.y && <button className="button primary full" disabled={busy} onClick={extract}>Request extraction</button>}{["extracting", "dead", "timedOut"].includes(run?.phase || "") && run?.delegated && <button className="button primary full" disabled={busy} onClick={finalize}>Commit and undelegate</button>}{receipt && <div className="card result"><p className="eyebrow">Solana receipt</p><strong>{receipt.phase === "extracted" ? "EXTRACTED" : receipt.phase.toUpperCase()}</strong><p>{receipt.phase === "extracted" ? `${receipt.finalScore} fictional gold secured.` : "No loot credited."}</p></div>}<button className="button secondary full" disabled={busy} onClick={() => run && refresh(run.index)}>Refresh router, ER and base state</button>{receipt && <button className="text-button" onClick={() => { setRun(null); setReceipt(null); if (storageKey) window.localStorage.removeItem(storageKey); }}>Start another run</button>}</aside></div>}
  </section>;
}
