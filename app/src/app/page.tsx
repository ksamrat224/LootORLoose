"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { HuntGame } from "@/game/HuntGame";
export default function Home() {
  const [playing, setPlaying] = useState(false);
  return (
    <main
      className={`quest-shell ${
        playing
          ? "quest-shell-playing hunt-dashboard-shell"
          : "quest-shell-welcome"
      }`}
    >
      {!playing && (
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
          <span className="q-brand-note">SIX QUESTS. THREE REVEALS.</span>
        </header>
      )}
      {playing ? (
        <HuntGame />
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
            <p className="q-eyebrow">ONE STAKE. THREE DISCOVERIES.</p>
            <h1 id="welcome-title">
              Your path.
              <br />
              <em>Your next quest.</em>
            </h1>
            <p>
              Stake once. Hunt three of six guardians. Reveal your hidden loot.
            </p>
            <button className="q-button" onClick={() => setPlaying(true)}>
              Play
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </button>
            <span className="q-demo">DEMO CREDITS · NO CASH VALUE</span>
            <Link href="/recovery">Recover an earlier V3 run ↗</Link>
          </div>
        </section>
      )}
    </main>
  );
}
