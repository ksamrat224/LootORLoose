# Loot or Lose

A three-minute, single-player dungeon extraction game. The program is deployed on Solana devnet, and live success and death paths have been verified through a MagicBlock Ephemeral Rollup and back to base-layer receipts.

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

## Devnet setup

The declared program ID and local deployment keypair both resolve to `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj`. Before deployment, verify that address yourself:

```bash
solana address -k target/deploy/loot_or_lose-keypair.json
solana balance --url devnet
```

The program was deployed on devnet at the address above on Nov 22, 2026. Deployment or upgrade signs and spends devnet SOL using the configured wallet. To rebuild and upgrade this same address, you need the original local program keypair:

```bash
NO_DNA=1 anchor build --ignore-keys
solana program deploy target/deploy/loot_or_lose.so --program-id target/deploy/loot_or_lose-keypair.json --url https://rpc.magicblock.app/devnet --use-rpc
solana program show BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj --url devnet
```

The program keypair is under ignored `target/` and is not part of a fresh clone. Keep it private; a fresh clone can build and use the deployed program, but cannot redeploy to the same address without that keypair.

Set `NEXT_PUBLIC_GAME_PROGRAM_ID=BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj` in `app/.env.local` and run the app. Copy the public endpoint values from the root `.env.example`; Next.js loads environment files from `app/`, not the repository root. The **Devnet run** tab supports wallet connection, profile/run creation, delegation, ER activation and actions, extraction, commit/undelegate, status refresh, and reload recovery. It shows `EXTRACTED` only after decoding a terminal receipt from the Solana base-layer account.

To repeat both live paths with the configured CLI wallet (this sends devnet transactions and creates two new runs):

```bash
cd app
node scripts/devnet-lifecycle.mjs
```

The script simulates every game transaction, checks router and ER ownership, confirms the base commitment signature, and reads each terminal base-layer receipt. The Nov 22 verification produced [extracted run 0](https://explorer.solana.com/address/Cfz748y9Hg4B8e2j7Pr8StgoyZin2ahxaMerc9z4Kv3w?cluster=devnet) with 75 HP and 10 fictional gold, and [dead run 1](https://explorer.solana.com/address/NyQU2TduZrLPPNroHxnKjHn8t8QNAxWmLDKv7t9TJJc?cluster=devnet) with 0 HP and 0 credited gold. The [deploy transaction](https://explorer.solana.com/tx/3Vr5gA3nyQrGgtr65xFHyyg3VbjYBzXMNm2d9LSVmLTwXxPrvpJFdfuvQwBFBY2zWpz4qYxddt93ZGX7xbVPbgZc?cluster=devnet) is also public.

## Current phase status

| Gate | Status |
| --- | --- |
| Playable local shell, frontend lint/build | Passed in this workspace |
| Program rule tests | Passed in LiteSVM |
| Live devnet run creation/delegation/ER write | Passed with configured CLI wallet |
| Live extraction/commit/undelegate and base receipt | Passed: extracted score 10; dead score 0 |
| Fresh-wallet happy/failure paths and demo video | Not done |
| Dependency security review | Not done; `npm audit --omit=dev` reports two high-severity advisories through Anchor's `toml` dependency |

Known limitations: the onchain UI signs each step rather than batching checkpoints; ER outage and ambiguous-submission recovery require live testing; no collectible minting, VRF, or session keys; no security audit. Do not treat the displayed fictional gold as an asset or a random reward.
