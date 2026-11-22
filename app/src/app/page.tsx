"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PhaserBoard } from "@/game/PhaserBoard";
import { OnchainGame } from "@/game/OnchainGame";
import { CHESTS, EXIT, INITIAL_DEMO, extract, move, openNearbyChest, pendingGold, type DemoState, type Direction } from "@/game/model";

export default function Home() {
  const [run, setRun] = useState<DemoState | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [mode, setMode] = useState<"local" | "onchain">("local");
  const onMove = useCallback((direction: Direction) => setRun((current) => current ? move(current, direction) : current), []);
  const onInteract = useCallback(() => setRun((current) => current ? openNearbyChest(current) : current), []);
  useEffect(() => {
    if (run?.outcome !== "active") return;
    const interval = window.setInterval(() => setRun((current) => {
      if (!current || current.outcome !== "active") return current;
      const secondsLeft = Math.max(0, current.secondsLeft - 1);
      return secondsLeft ? { ...current, secondsLeft } : { ...current, secondsLeft, outcome: "timed_out", message: "Local demo timer expired. Pending loot was lost." };
    }), 1000);
    return () => window.clearInterval(interval);
  }, [run?.outcome]);
  const gold = run ? pendingGold(run.opened) : 0;
  const atExit = run?.outcome === "active" && run.x === EXIT.x && run.y === EXIT.y;
  const time = run ? `${Math.floor(run.secondsLeft / 60).toString().padStart(2, "0")}:${(run.secondsLeft % 60).toString().padStart(2, "0")}` : "03:00";
  return <main className="shell">
    <header className="topbar"><Link className="wordmark" href="/"><span aria-hidden="true">◆</span> LOOT <em>OR</em> LOSE</Link><div className="badges"><span>DEVNET TARGET</span><strong>{mode === "local" ? "LOCAL DEMO" : "DEVNET MODE"}</strong></div></header>
    <div className="content"><nav className="mode-nav" aria-label="Game mode"><button className={mode === "local" ? "selected" : ""} onClick={() => setMode("local")}>Local demo</button><button className={mode === "onchain" ? "selected" : ""} onClick={() => setMode("onchain")}>Devnet run</button></nav>{mode === "onchain" ? <OnchainGame /> : !run ? <section className="landing">
      <div><p className="eyebrow">A three-minute dungeon extraction game</p><h1>One more room.<br /><em>Or get out alive.</em></h1><p className="intro">Find three chests, watch your health, and decide when to escape. This playable preview runs locally while wallet and MagicBlock integration are being built.</p><button className="button primary" onClick={() => setRun({ ...INITIAL_DEMO })}>Start local run →</button><p className="fineprint">Free demo · Fictional gold · No blockchain transaction</p></div>
      <aside className="card rules"><p className="eyebrow">How to play</p><ol><li><b>01</b> Move with WASD or arrow keys.</li><li><b>02</b> Press E beside a chest.</li><li><b>03</b> Avoid the guardian and reach the exit.</li></ol><p>In the onchain version, loot is secured only after extraction.</p></aside>
    </section> : <section className="run-layout">
      <div className="game-area"><div className="section-title"><div><p className="eyebrow">Dungeon / chamber 01</p><h1>{run.outcome === "active" ? "The vault" : run.outcome === "escaped" ? "You escaped" : "Run ended"}</h1></div><span className="demo-label">LOCAL DEMO</span></div><div className="board-frame"><PhaserBoard state={run} onMove={onMove} onInteract={onInteract} /></div><p className="message" role="status" aria-live="polite">{run.message}</p><div className="controls"><span><kbd>W A S D</kbd> or arrows — move</span><span><kbd>E</kbd> — open chest</span><span>Turquoise tile — exit</span></div></div>
      <aside className="sidebar"><div className="card"><p className="eyebrow">Run status</p><div className="stat"><span>Health</span><strong>{run.hp} / 100</strong></div><div className="meter"><span style={{ width: `${run.hp}%` }} /></div><div className="stat"><span>Time remaining</span><strong className="mono">{time}</strong></div><div className="stat"><span>Chests opened</span><strong>{CHESTS.filter((_, id) => run.opened & (1 << id)).length} / 3</strong></div></div>
      <div className="card"><p className="eyebrow">Unextracted loot</p><p className="gold">{gold} <small>fictional gold</small></p><p className="muted">Fixed demo sequence: 10, 40, 100. No verified randomness.</p></div>
      {run.outcome === "active" ? <button className="button primary full" disabled={!atExit} onClick={() => setRun((current) => current ? extract(current) : current)}>Extract at exit ↗</button> : <div className="card result"><p className="eyebrow">Local result</p><strong>{run.outcome === "escaped" ? "Escaped" : run.outcome === "dead" ? "Defeated" : "Timed out"}</strong><p>{run.outcome === "escaped" ? `${gold} fictional gold in this demo only.` : "Unextracted loot was lost."}</p><button className="button secondary full" onClick={() => setRun({ ...INITIAL_DEMO })}>New local run</button></div>}
      <button className="text-button" onClick={() => setDiagnostics((value) => !value)} aria-expanded={diagnostics}>Developer diagnostics {diagnostics ? "−" : "+"}</button>{diagnostics && <div className="diagnostics"><p>Mode: local simulation</p><p>Run account: none</p><p>ER endpoint: not connected</p><p>Base receipt: none</p><p>Position: {run.x}, {run.y}</p></div>}</aside>
    </section>}</div><footer className="footer"><span>LOOT OR LOSE / MVP</span><span>All scores are fictional. Onchain gameplay is under construction.</span></footer>
  </main>;
}
