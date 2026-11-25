"use client";
import Link from "next/link";
import { QuestGame } from "@/game/QuestGame";
export default function Recovery() {
  return (
    <main className="quest-shell quest-shell-playing">
      <header className="quest-brand">
        <b>V4 QUEST RECOVERY</b>
        <Link href="/">Back to new hunts</Link>
      </header>
      <QuestGame />
    </main>
  );
}
