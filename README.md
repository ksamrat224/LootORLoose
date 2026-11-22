# Loot or Lose

An in-progress, single-player dungeon extraction game for Solana devnet. Gameplay-critical state will run on MagicBlock Ephemeral Rollups and settle to Solana only after valid extraction.

## Workspace

- `app/` — Next.js, TypeScript, Tailwind, Phaser
- `programs/loot_or_lose/` — Anchor program scaffold
- `tests/` — game-state and integration tests (to be added)
- `scripts/` — devnet and verification utilities (to be added)
- `docs/MAGICBLOCK_ARCHITECTURE.md` — account and routing boundary

## Prerequisites validated

The official MagicBlock Counter / Anchor example passed its local MagicSVM lifecycle test on this machine: initialize → delegate → update on ER → commit → undelegate.

The compatibility baseline is Anchor `1.0.2`, Solana `3.1.x`, and Rust `ephemeral-rollups-sdk` `0.16.2` with the `anchor` feature.

## Run the frontend

```bash
cd app
npm run dev
```

Copy `.env.example` to `app/.env.local` only when wiring the wallet and MagicBlock client. The program ID must remain a placeholder until deployment.

## Current status

This is a scaffold, not a playable game yet. It does not submit transactions or use real funds.

# LootORLoose
