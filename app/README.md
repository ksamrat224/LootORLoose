# Loot or Lose — frontend

Next.js 16 + Phaser client for the Loot or Lose Anchor program. See the [root README](../README.md) for the full overview and [about.md](../about.md) for the product description.

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npm run build
npx playwright install chromium && npm test
npm run verify:devnet-wager   # live devnet lifecycle check (spends devnet SOL)
```

Copy `../.env.example` to `.env.local`. Set `NEXT_PUBLIC_WAGER_V3_ENABLED=true` to enable the devnet wager mode. Only public endpoints belong in env files.

Layout: `src/game/` (Phaser board, `WagerGame.tsx`, rules), `src/lib/` (wallet, chain/ER transport, recovery), `scripts/` (devnet verification), `tests/` (Playwright).
