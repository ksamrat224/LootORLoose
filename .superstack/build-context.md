# Build context — Loot or Lose

- **Architecture:** Next.js 16 App Router frontend in `app/`; Anchor 1.0.2 workspace at the repo root (`programs/loot_or_lose`); Phaser 3.90 for dungeon scenes.
- **Stack:** `ephemeral-rollups-sdk` 0.16.2 (VRF enabled), session-keys 3.1.1, Solana 3.1.x.
- **Status (Nov 25, 2026):** V1 free game, V2 session-key game and V3 demo-credit risk-gate wager are implemented. Program `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj` is upgraded on devnet with V3; live VRF success and failure settlements verified (see `docs/wager-prototype.md`).
- **Tests:** LiteSVM program tests, 23 Playwright browser/transport/unit tests, `npm run verify:devnet-wager` live check.
- **Open release gates:** fresh-wallet manual browser run; real outage-recovery exercise; hosted demo with V3 enabled.
- **Brand:** palette selection deferred; candidates in `.brand-preview/`.
- **Source of truth for docs:** `about.md`, `docs/wager-prototype.md`, `docs/MAGICBLOCK_ARCHITECTURE.md`. `docs/archive/` is historical.
