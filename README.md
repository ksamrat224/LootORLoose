# Loot or Lose

**Current UI: V6 rewards in new practice hunts; verified V5 rewards on devnet.** Stake once, explore six guardians, open three different quests and collect their combined random loot. New practice hunts average **95.55%** before cent rounding; existing V5 hunts retain **86.5%**. The compatible V6 program is deployed and live automated checks passed; `NEXT_PUBLIC_HUNT_V6_ENABLED=false` keeps normal devnet creation on V5 until guided Phantom verification passes. See [V6 release evidence](docs/DEVNET_V6_VERIFICATION.md). See [V6 economy and practice review](docs/HUNTS_V6.md), [V5 architecture](docs/HUNTS_V5.md), and [Nov 26 live session evidence and Phantom checklist](docs/DEVNET_SESSION_VERIFICATION.md). Earlier V3/V4 recovery remains at `/recovery` and `/recovery/quests`.

A dungeon extraction game with a three-gate, simulated-stake prototype. The original free game and its session-key upgrade were verified on Solana devnet through a MagicBlock Ephemeral Rollup and back to base-layer receipts. **The V3 wager program was upgraded on devnet on Nov 23, 2026.** All wager credits are nonredeemable demo units; there are no real deposits or cash prizes.

## Documentation map

- [docs/HUNTS_V6.md](docs/HUNTS_V6.md) — smoother practice rewards, compatibility and pending devnet rollout.
- [docs/HUNTS_V5.md](docs/HUNTS_V5.md) — deployed V5 gameplay, accounts and recovery.
- [docs/QUESTS_V4.md](docs/QUESTS_V4.md) — historical single-quest V4 rules and recovery.

- [about.md](about.md) — product description, rules, UI and honest limitations (start here).
- [docs/wager-prototype.md](docs/wager-prototype.md) — V3 architecture, verification and live devnet evidence.
- [docs/MAGICBLOCK_ARCHITECTURE.md](docs/MAGICBLOCK_ARCHITECTURE.md) — ER account boundary and routing rules.
- [docs/ROADMAP.md](docs/ROADMAP.md) — what's left to do, known issues and fixes, 2-day schedule, release checklist.
- [docs/UI_DIRECTION.md](docs/UI_DIRECTION.md) — UI critique and target design based on the reference images.
- [mvp.md](mvp.md) — the finished MVP, end to end.
- [docs/archive/](docs/archive/) — historical V1 idea, requirements and bootstrap guide (superseded).

## Run the local demo

```bash
cd app
npm ci
npm run dev
```

Open `http://localhost:3000` and choose **Play** to stake once and open three of six quests with V6 practice rewards. V4 devnet is gated by `NEXT_PUBLIC_QUEST_V4_ENABLED=false`. The following describes the earlier game at `/recovery`: **Risk gates → Local practice** offers $2/$5/custom demo stakes and voluntary 1.25×/2×/3× gates with published odds. Movement is safe, and returns include the stake. Practice uses browser randomness and resets when its game context is discarded; it creates no blockchain receipt. The original free local and devnet game code remains in the repository but is hidden from the landing page.

## Verify the source

```bash
NO_DNA=1 anchor build --ignore-keys
NO_DNA=1 cargo test -p loot_or_lose --tests
cd app
npm run lint
npm run build
npx playwright install chromium
npm test
```

The program uses Anchor 1.0.2, Rust MagicBlock SDK 0.16.2 with VRF enabled, session-keys 3.1.1, and a fixed 16×10 map. The app pins Phaser 3.90.0. LiteSVM tests cover the original game plus demo balances, payout reservations, scoped callbacks, exact payout math, single-run sessions, and idempotent settlement. Controlled callback fixtures bypass cryptographic signature verification only inside LiteSVM; they are not live VRF evidence. Playwright covers responsive practice flows and mocked-wallet recovery. See [wager architecture and verification](docs/wager-prototype.md).

## V3 wager rollout

`NEXT_PUBLIC_WAGER_V3_ENABLED=true` is the default in `.env.example` now that live VRF success/failure settlement checks have passed. Copy it to `app/.env.local`, restart `npm run dev` from `app/`, then choose **Risk gates → Devnet**. Set it to `false` to hide the wager mode. Existing receipts are preserved: V3 uses new PDA seeds and account types rather than resizing earlier accounts.

After the wallet was funded, the [V3 upgrade](https://explorer.solana.com/tx/3CKwV6qmWZ3fPqpwMLcdcXm81YYHW1RGJE7AtoTnsqaymd7Z9GJjby55mvZD9xDSgzMyQ7huZKFGX5PWYdkB47Mr?cluster=devnet) confirmed at slot **525323703**. The deployed 551,272-byte ELF was independently compared with the local binary: SHA-256 `32326ab3aaab75db90ef761155cb5c2d507203973e2fcc26012c779f0f931804`. Existing free-game receipts remained readable. Unrelated deployment buffers were left untouched.

To verify the deployed wager lifecycle using the configured CLI wallet:

```bash
cd app
npm run verify:devnet-wager
```

This command temporarily enables the V3 client **only in the verification process**, loads `app/.env.local`, verifies that the base-layer program bytes match the local binary before sending anything, and uses the configured CLI wallet. It makes $2 demo wagers, settles each before starting another, and stops after observing both outcomes or twelve rounds per invocation. It never rerolls a gate or changes odds. A temporary session costs a 0.002 devnet SOL top-up plus network fees; renewal may be needed. If interrupted, rerunning recovers the ledger's unresolved wager and recognizes already-settled V1-rules $2 success/failure evidence; once both exist with no unresolved wager, it sends no new wagers. A bounded random sample may not observe both outcomes; report that honestly rather than forcing one. Only after successful live verification should the app flag be set to `true` and the server restarted.

Nov 23 live evidence: [wager 0](https://explorer.solana.com/address/EGF1ZnNMQzvVb3VqbyHAx9KSc97ays67XpRrBsYm3sJH?cluster=devnet) extracted its $2 demo stake at 1.25× for $2.50 total ([base settlement](https://explorer.solana.com/tx/3KPj3dhsXu6zoQP6WVnKfAjLT3MXLexwx9pNfg2btz6U6hVFmFcXfLSxenvbvmEeEYDMYpbh4RwiL2BJiWGkRUWR?cluster=devnet)). [Wager 8](https://explorer.solana.com/address/EqSX6FZdnt3XL1SqdtAZt8zJLZfftGZeHgbiXXPF4Ugb?cluster=devnet) naturally failed gate 1 and settled for zero ([base settlement](https://explorer.solana.com/tx/nkK1motETzXKZjiwPTY8HuxmJHkMKDKRd5aazoJ5Zb6byafaBYKAr9NSoRCdwF87mbmAHSRieSbkbWGXXHqfd3J?cluster=devnet)). Nine distinct wagers were created across the interrupted/resumed verification: eight extracted successes and one failure, with no rerolls. Final base reads showed player **10,200 cents**, house **999,800 cents**, reserved **0**, and no active wager. Real VRF callback logs were read on the router-resolved Asia ER. This CLI evidence does not establish fresh-wallet live browser reliability; automated browser recovery tests use RPC fixtures.

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

Copy the public endpoint values from the root `.env.example` into `app/.env.local`; Next.js loads environment files from `app/`, not the repository root. The upgraded program and session-key path were verified on devnet on Nov 22, 2026, so this workspace has `NEXT_PUBLIC_GAME_V2_ENABLED=true` in `app/.env.local`. Restart the app after changing this flag. The **Devnet run** tab creates a four-minute, program-scoped temporary signer with one wallet approval and a 0.002 devnet SOL fee top-up. The key remains only in the open tab; reload requires a new session. Movement responds immediately, checkpoints at up to 12 tiles, and reconciles with ER state. Final commit remains wallet-signed. The UI shows `EXTRACTED` only after decoding a terminal Solana base-layer receipt.

After upgrading the program, repeat both live paths with the configured CLI wallet (this sends devnet transactions and creates two new runs):

```bash
cd app
node scripts/devnet-lifecycle.mjs
```

To verify the temporary-signer path, run `node scripts/devnet-lifecycle.mjs --session` instead. This creates a new four-minute token for each run, transfers 0.002 devnet SOL to each signer for fees, signs gameplay with that signer, then wallet-signs finalization. If a previously created run is still delegated and in `CREATED` phase, `--resume-index=N` resumes that run as the success path before creating the failure path.

The script simulates every game transaction, checks router and ER ownership, confirms the base commitment signature, and reads each terminal base-layer receipt. The Nov 22 verification produced [extracted run 0](https://explorer.solana.com/address/Cfz748y9Hg4B8e2j7Pr8StgoyZin2ahxaMerc9z4Kv3w?cluster=devnet) with 75 HP and 10 fictional gold, and [dead run 1](https://explorer.solana.com/address/NyQU2TduZrLPPNroHxnKjHn8t8QNAxWmLDKv7t9TJJc?cluster=devnet) with 0 HP and 0 credited gold. The [deploy transaction](https://explorer.solana.com/tx/3Vr5gA3nyQrGgtr65xFHyyg3VbjYBzXMNm2d9LSVmLTwXxPrvpJFdfuvQwBFBY2zWpz4qYxddt93ZGX7xbVPbgZc?cluster=devnet) is also public.

The session-aware [upgrade transaction](https://explorer.solana.com/tx/5JUKKSqgKojdhVCJGWsPhPqmdUT77kBx5L9o7rD1zhsQmNn6yH1sbKvHnYe5ju4JasbDDNX6qz7ry3FP2fxqjrPu?cluster=devnet) was confirmed on Nov 22, 2026. Session-signed gameplay then produced [extracted run 2](https://explorer.solana.com/address/87H7Sdgshe3FBmUEVegjWjdbry48nieQ9zbzZ74eaTf4?cluster=devnet), independently read on base devnet with 75 HP and score 10, and [dead run 3](https://explorer.solana.com/address/GpW9wYhf8VNoaiJqMeR6TAjHxZaAXDwR4WKQux5GSwuf?cluster=devnet), read with 0 HP and score 0. Their base commitment signatures were `4svTtHdBbe4pCX95qcTaeiKsxuzwaDCBUGYusJPwZrD7wKoDqfghtoaG9AdzzUkWVhWke6RxkitU4d6bb5yFSfJC` and `2QnMntDAJQy5evMgLjKsHj4NyorNxurZGRuM4kLte37WUMGCEo5hjT1857wZKsrjBAg2gHut5pAaviQwyoaGVRw1`.

## Current phase status

| Gate | Status |
| --- | --- |
| Playable local shell, frontend lint/build | Passed in this workspace |
| Program rule tests | Passed in LiteSVM |
| Free-game V2 devnet creation/delegation/ER write | Passed on the deployed session-aware binary |
| Free-game V2 extraction/commit/undelegate and base receipt | Passed: extracted score 10; dead score 0 |
| Free-game V2 session-key gameplay on a live ER | Passed on success and failure paths |
| V3 wager ledger, rules, VRF handler | Local checks and live session-signed VRF success/failure base settlements passed |
| V3 browser recovery | 17 automated tests passed; devnet recovery uses mocked RPC, not live outage evidence |
| Fresh-wallet happy/failure paths and demo video | Not done |
| Dependency security review | Pending; Solana/MagicBlock dependency advisories remain unresolved |

Known limitations: free-game V2 tokens are program-scoped; V3 additionally binds its session signer to one wager. Signers are kept in memory and lost on reload. Live CLI recovery resumed an interrupted wager without a duplicate stake; real ER/oracle outage and fresh-wallet browser recovery still require manual live testing. Mocked-wallet recovery is not live service evidence. Pending VRF requests have no automatic outage refund. No collectible minting or security audit is included. Fictional gold and demo credits are not assets.
