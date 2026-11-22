# Loot or Lose — MVP Requirements

**Version:** 0.1 — November 22, 2026  
**Target:** Playable, verifiable Solana Blitz V10 demo by November 27, 2026  
**Priority convention:** P0 = must ship; P1 = stretch; P2 = after hackathon

## 1. Scope & acceptance contract

**In scope (P0):** single-player desktop browser game; one compact dungeon; movement, chests, one enemy, health, death/timeout, extraction; wallet connection; valid MagicBlock ER integration; Solana devnet settlement/receipt; visible run summary and status states.

**Excluded (P2):** real funds, USDC bets, live financial assets, in-game exchange/marketplace, PvP, multiplayer syncing, 3D graphics, procedural levels, crafting, guilds, paid entry, private rollups.

**P1 if ahead of schedule:** verified VRF loot rolls, actual NFT mint for one extraction reward, session keys, sound, tutorial, mobile controls.

## 2. User stories & functional requirements

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| F-01 | P0 | Connect wallet to devnet | Wallet address and network appear; wrong network/error is handled |
| F-02 | P0 | Create a run | Player can start a new run; unique run ID and initial health/inventory are initialized correctly |
| F-03 | P0 | Enter and move through a dungeon | WASD/arrow keys work; movement is bounded by walls; display is smooth |
| F-04 | P0 | Authoritative gameplay actions | Meaningful position/room actions validated by game program via ER; frontend alone cannot award items |
| F-05 | P0 | Open chests | Each chest opens at most once per run; award is taken from configured item table; duplicated commands do not duplicate loot |
| F-06 | P0 | Enemy and damage | One enemy behavior; damage applied by authoritative rules; HP never drops below zero |
| F-07 | P0 | Death/failure | At 0 HP or timeout, run is marked failed; unextracted loot cannot settle |
| F-08 | P0 | Exit/extract | Only alive player at valid exit with active run can extract; extraction is idempotent |
| F-09 | P0 | Commit outcome to Solana | Success state survives finalization; UI shows transaction signature/explorer URL; verify persistent base-layer account |
| F-10 | P0 | Results screen | Shows success/failure, loot, fictional gold score, and onchain/ER statuses without misleading labels |
| F-11 | P0 | Replay | A finalized/failed run cannot resume; user can create a new run without corrupting prior records |
| F-12 | P0 | Error handling | Network/transaction failures show retry or recoverable message, not false success |
| F-13 | P1 | VRF loot | Prizes selected using actual MagicBlock VRF; proof/request flow and table are inspectable |
| F-14 | P1 | Mint collectible | One eligible extracted reward minted on devnet; idempotent mint, ownership and explorer link verified |
| F-15 | P1 | Session keys | Trusted short-lived session authority reduces prompts while preserving restrictions |

## 3. Gameplay state machine

`CREATED -> ACTIVE -> EXTRACTING -> EXTRACTED`

`ACTIVE -> DEAD` (HP = 0); `ACTIVE -> TIMED_OUT` (limit exceeded).

`EXTRACTING -> ACTIVE` only if settlement initiation fails before finalization and the run is safely recoverable; do **not** reopen a successfully finalized run. Use an explicit intermediate/recovery state as necessary once the account lifecycle is validated.

**Invariants:**

- A run has exactly one player authority and a unique run identifier.
- Chests have persistent per-run `opened` flags; duplicate requests are harmless.
- No client-created assets/health/score are accepted without program validation.
- Only a live, active, exit-eligible run may be extracted.
- Exactly one final outcome per run; extraction cannot be applied twice.
- Loot is nontransferable pending extraction; failed-run loot is never credited to permanent inventory.
- Do not depend on a browser clock for authoritative timeout; use validated onchain/rollup time semantics.

## 4. State and program design (proposed; adjust to latest SDK)

### Persistent base-layer accounts

- `PlayerProfile` PDA: player pubkey and accumulated extraction stats; optionally inventory receipt metadata.
- `RunState` PDA: player, run index, phase, committed outcome/score, and delegation lifecycle.
- `ItemCatalog` or constants: fixed IDs, rarity, scoring value, and max counts.

### Runtime/delegated state

`RunState` includes at least: run ID; authority; current position/room; HP; phase; start/end constraints; chest-open bitmap; pending item counts; final score; nonce/version to prevent command replay. Exact account layout is to be fixed against the chosen ER starter example.

### Candidate instructions

- `initialize_player` / `create_run`: base-layer setup.
- `delegate_run`: delegate relevant state to ER following SDK pattern.
- `move_player` / `enter_room`: validate walls and boundaries.
- `open_chest`: enforce proximity and one-time use; assign reward (fixed/deterministic first; VRF integration as P1).
- `resolve_enemy_turn` / `apply_damage`: validated combat outcome, bounded damage.
- `request_extraction`: validate exit/HP/phase and freeze outcome.
- `commit_and_undelegate` or documented equivalent: finalize state to Solana and release delegation.
- `claim_extracted_reward`: optional, only after committed successful run; idempotent.

**Important:** Names above are product-level interfaces, **not verified SDK API function names**. Use the current MagicBlock examples for actual CPI calls, account constraints, and commit lifecycle.

## 5. Frontend screens

1. **Landing:** title, connect wallet, Start Run, brief instructions.
2. **Dungeon:** tilemap, player, chests/enemy/exit, HP, unextracted fictional score, action messages.
3. **Extraction confirmation:** warning that continuing exposes pending loot to loss; confirm only at exit.
4. **Result:** success/death/timeout, loot summary, transaction links and claim state.
5. **Diagnostics (developer toggle):** base RPC, ER endpoint, run account, delegation phase, last signatures, reconciliation/error state.

Use a keyboard-first layout; support 1280×720 desktop. A basic responsive fallback is acceptable, but mobile gameplay is out of scope.

## 6. Nonfunctional requirements

- **Integrity:** All game-critical rewards and transitions validated authoritatively; replay-safe and idempotent.
- **Reliability:** Never display `EXTRACTED` until chain confirmation and onchain state are independently checked.
- **Latency:** Client renders animation at roughly 30–60 FPS on an ordinary laptop; ER transactions and confirmations are asynchronous. Do not promise a specific network latency without measurements.
- **Observability:** Structured debug logs for run ID, instruction, signatures, RPC errors, pending/final state.
- **Usability:** First-time user can finish a demo without developer guidance in under 5 minutes.
- **Security:** No production secrets in frontend or Git; use disposable devnet keys; require wallet authorization for durable player actions.
- **Accessibility:** Visible keyboard help and text status indicators; don't rely only on color.

## 7. Technical dependencies

- TypeScript, React / Next.js, Phaser 3.
- Rust, Solana CLI, Anchor CLI.
- Current MagicBlock ER Rust and TS SDK, compatible with selected Anchor version.
- `@solana/web3.js` client or `@solana/kit` client (select one consistently with SDK).
- Wallet adapter compatible with the selected frontend stack.
- Solana devnet for persistence; local MagicBlock test nodes for integration tests.
- Optional: Metaplex Core for P1 minting, latest MagicBlock VRF example for P1 randomness.

## 8. Verification tests

**Unit / model tests:** map bounds, loot table bounds, scoring, health clamps, valid transition graph, timer semantics.

**Program integration tests:**

- Only run owner can issue gameplay action.
- Invalid movement/teleport is rejected.
- Reopened chest awards nothing extra.
- Failed run cannot extract or claim.
- Extract attempt away from exit is rejected.
- Repeated extraction/claim does not duplicate final state or reward.
- Delegated run state can be committed and verified on Solana; ER and base-layer outcomes agree.
- Network interruption after sending extraction can be reconciled safely.

**Manual end-to-end demo:**

1. Connect wallet → create run → verify initial state.
2. Enter room/open chest → verify authoritative change.
3. Lose health → verify chain/ER state.
4. Escape → commit and verify final account on base layer.
5. Start fresh run; die with loot → verify no extraction reward.

## 9. Milestones and cut order

| Date | Required deliverable | Gate |
|---|---|---|
| Nov 22 | Repo, architecture, playable local movement stub, ER counter proof | ER local example works |
| Nov 23 | Program accounts, wallet, create/delegate run | Delegated run state writable |
| Nov 24 | Chest, damage, escape game loop | One complete run with authoritative updates |
| Nov 25 | Commit/undelegate, resilient UI & tests | Verified persistent success/failure outcome |
| Nov 26 | Polished demo, screenshots, brief video, writeup | Judge can follow end-to-end |
| Nov 27 | Buffer, deployment and submission | Demo builds from fresh clone |

**Cut order under deadline:** audio/particles → multiple enemies → more rooms → fancy inventory → NFT mint → VRF. **Do not cut genuine ER usage, successful settlement, and credible demo verification.** If VRF is cut, remove all public claims of provable randomness.

## 10. Definition of done

- [ ] Fresh clone builds with documented commands.
- [ ] Solana/devnet and ER configurations use environment variables.
- [ ] An actual MagicBlock ER account undergoes gameplay action(s).
- [ ] Successful extraction is confirmed and inspectable on Solana devnet.
- [ ] Failure cannot credit pending loot; duplicate actions blocked.
- [ ] UI handles pending/failed/finalized states accurately.
- [ ] Demo video + README explain the ER integration and limitation of any mocked features.
- [ ] No paid entry, real-money payout, or misleading investment language.

## References

- https://docs.magicblock.gg/
- https://github.com/magicblock-labs/magicblock-engine-examples
- https://github.com/magicblock-labs/ephemeral-rollups-sdk
