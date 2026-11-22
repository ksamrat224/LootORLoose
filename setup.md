# Loot or Lose — Developer Setup & Implementation Guide

**Last reviewed:** November 22, 2026  
**Target environment:** Linux/macOS (Windows via WSL2 recommended)  
**Status:** Bootstrap instructions and implementation plan, **not** a claim that a complete repository currently exists.

> **Read first:** This repository has not been generated yet. This document describes how to scaffold it, prove the MagicBlock integration, and build the MVP. SDK specifics change; use the linked current examples as the source of truth for exact versions, imports, macros, and account constraints.

## 1. Prerequisites

Install Git, a current Node.js LTS version compatible with the examples you select, `pnpm` (or the examples' `yarn`), Rust/Rustup, Solana/Agave CLI, Anchor Version Manager (`avm`) + Anchor, and a browser wallet configured for devnet.

Check your environment:

```bash
git --version
node --version
corepack --version
rustc --version
cargo --version
solana --version
anchor --version
```

**Compatibility warning:** Check the example's `Anchor.toml`, `Cargo.toml`, and `package.json` *before* choosing Anchor and Solana versions. The MagicBlock SDK now distinguishes Rust feature compatibility for Anchor 1.0 (`anchor`) versus older Anchor (`anchor-compat`). Avoid mixing old tutorials with new SDK versions.

## 2. First prove MagicBlock works (do this before the game)

Use the active integration examples:

```bash
git clone https://github.com/magicblock-labs/magicblock-engine-examples.git
cd magicblock-engine-examples
```

The examples README documents local test infrastructure. Typical commands are:

```bash
npm install -g @magicblock-labs/ephemeral-validator@latest
# Choose a CURRENT example folder such as counter/anchor;
# verify actual path in the cloned repo first.
cd <selected-example-directory>
yarn install
yarn setup
yarn test:local
```

**Expected proof:** successful delegation of a state account, an update sent to the ER, a commit/undelegate, and the updated state observed on the base chain. Record transaction signatures and the compatible tool versions. If this does not work, do not spend Day 1 building graphics.

The examples describe local nodes such as a Solana test validator (commonly port 8899) and an ER validator (commonly port 7799), plus an optional privacy query service. Treat these as **example defaults**, not hardcoded production addresses.

## 3. Create our application workspace

Recommended monorepo layout:

```text
loot-or-lose/
├── app/                     # Next.js + Phaser frontend
│   ├── src/app/              # routes/layout
│   ├── src/game/             # Phaser scenes and assets
│   ├── src/components/       # UI and HUD
│   └── src/lib/              # wallet, ER client, program helpers
├── programs/
│   └── loot_or_lose/         # Anchor game-state program
├── tests/                    # Anchor/ER integration tests
├── scripts/                  # devnet setup + verification scripts
├── assets/                   # licensed/created sprite assets
├── idea.md
├── requirement.md
├── setup.md
├── Anchor.toml
├── .env.example
└── README.md
```

Scaffold an initial Next.js frontend:

```bash
mkdir loot-or-lose && cd loot-or-lose
npx create-next-app@latest app --typescript --tailwind --eslint --app --src-dir
cd app
npm install phaser @solana/web3.js
cd ..
```

Create the Anchor workspace **using the same version selected for your MagicBlock example**:

```bash
# In a new directory if required, or initialize carefully to avoid
# overwriting an existing workspace. Check `anchor init --help` first.
anchor init loot-or-lose-anchor
```

Move/copy the generated Anchor files into the intended monorepo after checking paths and git changes. An easier alternative is to **fork a current working MagicBlock Anchor example** and add the frontend alongside it. That is my preferred approach under hackathon time pressure.

## 4. Configure a disposable devnet wallet

```bash
solana-keygen new --outfile ~/.config/solana/loot-or-lose-devnet.json
solana config set --url devnet
solana config set --keypair ~/.config/solana/loot-or-lose-devnet.json
solana address
solana airdrop 2
solana balance
```

Devnet airdrops can be rate-limited. Do **not** commit this keypair or paste it into frontend environment variables. Browser wallets hold user keys; server-only secrets remain on the server. Never use a production/mainnet wallet to test a hackathon build.

## 5. Environment variables

Create a local `.env.local` for the frontend and a `.env.example` in Git. Replace placeholders with official currently-supported endpoints from the documentation/example you actually run:

```dotenv
# app/.env.local — public, nonsecret RPC URLs only
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL=<current-devnet-er-rpc>
NEXT_PUBLIC_GAME_PROGRAM_ID=<deployed-anchor-program-id>
NEXT_PUBLIC_NETWORK=devnet
```

The precise ER endpoint can depend on validator choice, router, delegation, and local-versus-devnet setup. Verify with the example first. **Do not put private keys, API secrets, or signing seeds in NEXT_PUBLIC variables.**

## 6. Client and game setup

Suggested stack:

- **Next.js + React:** shell, wallet connection, loading, result views.
- **Phaser 3:** one Tilemap scene, player sprite, enemy, chest tiles, exit tile, keyboard controls.
- **Anchor / Solana client:** signed account creation, run initialization, and finalization.
- **MagicBlock TS SDK:** route transactions to the appropriate base/ER connection according to the chosen example.

Initial frontend implementation order:

1. Run `npm run dev` inside `app/` and open `http://localhost:3000`.
2. Render a tile-grid and movable player with wall collision in Phaser **locally**.
3. Add a HUD displaying local HP, pending items, run state, and an explicit `DEMO/LOCAL` label until connected.
4. Connect wallet and load `RunState` from the correct RPC.
5. Replace fake chest awards/HP/exit with **authoritative** program transactions; reconcile client visuals with confirmed state.
6. Show separate `submitted`, `confirmed on ER`, `committing`, and `confirmed on Solana` statuses.

## 7. Solana / ER integration plan

1. **Define a minimal `RunState`** PDA with player, run nonce, phase, room, HP, chest bitmap, pending rewards, and final score.
2. **Initialize on Solana.** Confirm address derivation, ownership, and rent funding.
3. **Delegate using the verified SDK/example.** Log delegation status and target ER.
4. **Call ER actions** to update run state; reject unauthorized, impossible, stale, and repeated actions.
5. **Request extraction on ER** only if player is alive, active, and standing on the exit tile.
6. **Commit/undelegate using the SDK's documented lifecycle.** Wait for real confirmation.
7. **Fetch base-layer state** independently and compare final status/score with ER's record.
8. **Optionally claim/mint** one reward after successful persisted extraction; maintain a durable claimed flag to prevent doubles.

**Authority / trust boundary:** A visually smooth game is not equivalent to an authoritative blockchain game. The server/program determines HP, chest outcomes, inventory, and extraction eligibility. A client-supplied score must never be considered proof of extraction.

**Gameplay implementation tradeoff:** For five-day scope, prefer discrete move/room actions (or server-authoritative movement checkpoints) rather than a transaction for every rendered frame. Validate position changes and maximum movement rates; don't allow client teleporting.

## 8. Randomness, rewards, and minting

**Phase A, required:** Use a clearly labeled deterministic or demo item sequence to prove chest handling and settlement. This is *not* fair/random onchain loot.

**Phase B, optional:** Integrate the active MagicBlock `Roll Dice / Anchor` or `Magic Gachapon` example to request genuine VRF outcomes. Bind requests to unique `(run_id, chest_id)` pairs; ensure replay protection; handle asynchronous responses and failed/retried requests; publish rarity probabilities.

**Phase C, optional:** Use the active Gachapon minting example (Metaplex Core) to mint one devnet collectible only after committed, valid extraction. Never mint directly from unverified browser state. A durable onchain inventory receipt is an acceptable MVP substitute.

## 9. Tests and commands

After scaffolding, expected commands **may include** (adjust to actual workspace scripts):

```bash
# frontend
cd app
npm run dev
npm run build
npm run lint

# Anchor project (at its workspace root)
anchor build
anchor test
```

The MagicBlock examples often provide `yarn setup` and `yarn test:local`; use their README-specific commands for local validator integration, not an assumed universal CLI.

Automate these specific checks:

- Owner-only interaction and valid movement boundaries.
- Duplicate chest opening doesn't double-award.
- HP reaches zero only under valid combat/damage rules.
- Dead/timed-out players cannot extract.
- Extraction can finalize only once and only from the exit.
- Base-chain committed state is visible after ER settlement.
- Reopening the app after extraction reads persisted outcome.
- Wallet rejection / ER RPC outage / lost confirmation yield accurate UI states.

## 10. Deployment & submission checklist

- [ ] Deploy Anchor program to devnet; record program ID and upgrade authority status.
- [ ] Configure verified devnet base and ER RPC endpoints.
- [ ] Build and host frontend; confirm wallet interaction in a clean browser.
- [ ] Run fresh-wallet happy path and failure path.
- [ ] Record a 2–3 minute demo with visible verifiable transactions.
- [ ] Write README with game pitch, real MagicBlock integration, screenshots, known limitations, and instructions.
- [ ] List only features that are actually implemented; label any simulated economy/loot clearly.
- [ ] Submit through official hackathon portal before the event deadline.

## 11. Common failure modes

| Symptom | Likely cause | First check |
|---|---|---|
| ER transaction rejects | Account not delegated / wrong authority / wrong endpoint | Delegation status and SDK connection routing |
| Client shows success, chain does not | UI assumed submitted = finalized | Await confirmation and re-fetch account |
| Chest can open twice | Missing per-chest used flag / replay guard | PDA state, bitmap, transaction retry behavior |
| Player can teleport | Trusting absolute x/y submitted by client | Restrict displacement and validate tiles |
| Mint succeeds on death | Reward claim not checking committed success | Claim conditions and idempotency state |
| Compilation conflicts | Mixed Anchor/Solana/SDK versions | Example's pinned versions and Rust feature flags |

## 12. Official references

- Docs: https://docs.magicblock.gg/
- Working integration examples (recommended first stop): https://github.com/magicblock-labs/magicblock-engine-examples
- ER SDK / compatibility notes: https://github.com/magicblock-labs/ephemeral-rollups-sdk
- MagicBlock developer skill: https://github.com/magicblock-labs/magicblock-dev-skill
- Solana CLI docs: https://solana.com/docs/intro/installation
- Anchor docs: https://www.anchor-lang.com/docs/installation

---

### Immediate next engineering task

**Prove a delegated counter/account update and final Solana commit with the current MagicBlock example; save the working version matrix and transaction traces.** Only then build the dungeon logic against that known-good scaffold.
