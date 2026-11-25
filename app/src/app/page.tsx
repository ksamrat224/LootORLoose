"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { QuestGame } from "@/game/QuestGame";
export default function Home() {
  const [playing, setPlaying] = useState(false);
  return (
    <main
      className={`quest-shell ${
        playing ? "quest-shell-playing" : "quest-shell-welcome"
      }`}
    >
      <header className="quest-brand">
        <span>
          <Image
            src="/brand/brand-logo.png"
            alt=""
            width={36}
            height={36}
            priority
          />
          <b>
            LOOT <em>OR</em> LOSE
          </b>
        </span>
        <span className="q-brand-note">SIX QUESTS. YOUR CHOICE.</span>
      </header>
      {playing ? (
        <QuestGame />
      ) : (
        <section className="quest-welcome" aria-labelledby="welcome-title">
          <Image
            className="quest-hero"
            src="/brand/pixel-hero.png"
            alt=""
            fill
            sizes="100vw"
            priority
          />
          <div className="quest-welcome-copy">
            <p className="q-eyebrow">A DUNGEON OF INDEPENDENT QUESTS</p>
            <h1 id="welcome-title">
              Your path.
              <br />
              <em>Your next quest.</em>
            </h1>
            <p>
              Choose your stake. Hunt any of six guardians. Reveal your outcome.
            </p>
            <button className="q-button" onClick={() => setPlaying(true)}>
              Play <span aria-hidden="true">→</span>
            </button>
            <span className="q-demo">DEMO CREDITS · NO CASH VALUE</span>
            <Link href="/recovery">Recover an earlier V3 run ↗</Link>
          </div>
        </section>
      )}
    </main>
  );
}
