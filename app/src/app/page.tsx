import Link from "next/link";
import { WagerGame } from "@/game/WagerGame";

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="wordmark" href="/">
          <span aria-hidden="true">◆</span> LOOT <em>OR</em> LOSE
        </Link>
        <div className="badges">
          <span>DEVNET TARGET</span>
          <strong>DEMO WAGER</strong>
        </div>
      </header>
      <div className="content">
        <WagerGame />
      </div>
      <footer className="footer">
        <span>LOOT OR LOSE / MVP</span>
        <span>
          Demo credits have no cash value. No real deposits or cash prizes.
        </span>
      </footer>
    </main>
  );
}
