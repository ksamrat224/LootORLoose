"use client";

import { useState } from "react";
import { WagerGame } from "@/game/WagerGame";

export default function Home() {
  const [playing, setPlaying] = useState(false);
  return (
    <main className={`shell ${playing ? "in-game" : "welcome-shell"}`}>
      <header className="topbar">
        <span className="wordmark">
          <span aria-hidden="true">◆</span> LOOT <em>OR</em> LOSE
        </span>
        <span className="top-note">A DUNGEON OF DECISIONS</span>
      </header>
      {playing ? (
        <div className="content">
          <WagerGame />
        </div>
      ) : (
        <section className="welcome" aria-labelledby="welcome-title">
          <div className="welcome-glow" aria-hidden="true">
            <div className="welcome-door">
              <span>◆</span>
            </div>
          </div>
          <div className="welcome-copy">
            <p className="eyebrow">A THREE-GATE EXTRACTION GAME</p>
            <h1 id="welcome-title">
              The vault is open.
              <br />
              <em>How far will you go?</em>
            </h1>
            <p>
              Walk the dungeon. Face three guardians. Choose when to take your
              haul and leave.
            </p>
            <button
              className="button primary welcome-play"
              onClick={() => setPlaying(true)}
            >
              Play <span aria-hidden="true">→</span>
            </button>
            <span className="welcome-footnote">
              FREE TO EXPLORE · DEMO CREDITS ONLY
            </span>
          </div>
          <div className="welcome-steps" aria-label="How to play">
            <span>
              <b>01</b> Choose your stake
            </span>
            <span>
              <b>02</b> Face the guardians
            </span>
            <span>
              <b>03</b> Extract your haul
            </span>
          </div>
        </section>
      )}
      <footer className="footer">
        <span>LOOT OR LOSE / DEVNET DEMO</span>
        <span>
          Demo credits have no cash value. No real deposits or cash prizes.
        </span>
      </footer>
    </main>
  );
}
