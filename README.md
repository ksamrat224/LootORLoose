# Loot or Lose

A three-minute, single-player dungeon extraction game. The local demo is playable now. The Solana devnet/MagicBlock path is implemented in source but has **not** been deployed or verified end to end.

## Run the local demo

```bash
cd app
npm ci
npm run dev
```

Open `http://localhost:3000` and choose **Local demo**. Move with WASD or arrows, press E beside chests, and reach the turquoise exit. This mode never sends a transaction; all gold is fictional.

## Verify the source

```bash
NO_DNA=1 anchor build --ignore-keys
NO_DNA=1 cargo test -p loot_or_lose --test game_rules
cd app
npm run lint
npm run build
```

The program uses Anchor 1.0.2, Rust MagicBlock SDK 0.16.2, and a fixed 16×10 map. The app pins Phaser 3.90.0. The program tests cover wrong-owner actions, walls, stale nonces, duplicate/distant chests, exit eligibility, guardian death, and timeout. They use LiteSVM, **not** a live MagicBlock ER.

## Devnet setup (not yet verified)

The declared program ID and local deployment keypair both resolve to `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj`. Before deployment, verify that address yourself:

```bash
solana address -k target/deploy/loot_or_lose-keypair.json
solana balance --url devnet
```

Deployment signs and spends devnet SOL using the configured wallet. Do this only when you are ready:

```bash
NO_DNA=1 anchor build --ignore-keys
anchor deploy --provider.cluster devnet
solana program show BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj --url devnet
```

The program keypair is under ignored `target/` and is not part of a fresh clone. Keep it private; a fresh clone can build and use the deployed program, but cannot redeploy to the same address without that keypair.

Then set `NEXT_PUBLIC_GAME_PROGRAM_ID=BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj` in `app/.env.local` and run the app. Public endpoint defaults are in `.env.example`. The **Devnet run** tab supports wallet connection, profile/run creation, delegation, ER activation and actions, extraction, commit/undelegate, status refresh, and reload recovery. It shows `EXTRACTED` only after decoding a terminal receipt from the Solana base-layer account.

## Current phase status

| Gate | Status |
| --- | --- |
| Playable local shell, frontend lint/build | Passed in this workspace |
| Program rule tests | Passed in LiteSVM |
| Live devnet run creation/delegation/ER write | Not tested; program is not deployed |
| Live extraction/commit/undelegate and base receipt | Not tested |
| Fresh-wallet happy/failure paths and demo video | Not done |
| Dependency security review | Not done; `npm audit --omit=dev` reports two high-severity advisories through Anchor's `toml` dependency |

Known limitations: the onchain UI signs each step rather than batching checkpoints; ER outage and ambiguous-submission recovery require live testing; no collectible minting, VRF, or session keys; no security audit. Do not treat the displayed fictional gold as an asset or a random reward.
