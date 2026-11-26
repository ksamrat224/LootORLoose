# Loot or Lose — Current Hunt Gameplay Roadmap

## Current baseline (November 26, 2026)

The active game is the V5/V6 hunt: stake once, walk to any three distinct guardians, reveal independent rewards from a shared pool, and collect once. V6 practice and the compatible deployed program already exist. Normal devnet creation remains V5 until required manual Phantom verification passes. See [V6 status](docs/HUNTS_V6.md).

MagicBlock delegation, authenticated VRF, sessions, approach-path validation, proof recomputation and exactly-once settlement are implemented. Earlier V1/V2 code has HP, a deadline and exits; it is not the current hunt. Inventory, six room-specific reward tables and an authoritative leaderboard are not implemented.

Current code lives under `app/src/game/` and `programs/loot_or_lose/src/`. Original idea, requirements and setup files are historical documents in `docs/archive/`.

## Current implementation phases

1. **Baseline:** retain the six guardian positions, artwork, map, V5/V6 rewards, transaction interfaces and existing recovery.
2. **Daily Route:** rotate the 20 lexicographically ordered three-guardian combinations using `floor(UTC epoch milliseconds / 86400000) % 20`. Publish the target before staking and in the Journal. Show compact progress on the Journal button, keeping the board free of route overlays. An off-route reveal marks the optional route missed while the hunt continues. Any order is valid and players may ignore it. Pin the UTC day at Start hunt. No additional stake, bonus or transaction.
3. **Local progress:** count successful player tile moves until reveal three. Only confirmed collection of the exact three targets earns a daily stamp and eligible personal best. Zero rewards count. Waiting, blocked movement and dialogs add no steps. A reload retains the route but makes its walking score unranked. Existing hunts without route metadata are untracked. Steps begin at the current starting tile, so records are personal local goals, not competitive scores.
4. **Recovery and review:** keep route records separate from balances and transactions; isolate practice and each devnet network/program/wallet. Storage failure must not stop a hunt. Run frontend lint, build and browser tests, including rollover, collection, reload, wallet changes and viewport checks. Review replay value with real players; do not claim retention gains from implementation alone.

The Daily Route is cosmetic and browser-local. It does not prove movement onchain. Normal V6 activation and actual-user Phantom checks remain separate release gates.

## Daily Route verification — November 26, 2026

- `npm --prefix app run lint`: passed.
- `npm --prefix app test -- --workers=4`: **120 passed**. Added daily-combination, confirmed-collection, zero-loot, exact walking count, UTC rollover, reload/unranked and idempotency checks. Expanded existing browser tests for route storage failure and practice/connected-wallet/disconnected isolation. Existing reward, proof, approval, recovery and responsive tests remain passing.
- `NEXT_TEST_DIST=.next-live-hunts NEXT_PUBLIC_HUNT_V6_ENABLED=false npm --prefix app run build`: passed.
- Journal screenshots reviewed at 375×667 and 1280×720 (`/tmp/daily-route-375.png`, `/tmp/daily-route-1280.png`); internal scrolling and no document overflow. Existing suite also covers 768×900, 844×390 and 1920×1080 dashboard layouts.
- Program sources, IDL/client chain interfaces, reward calculations, SVG artwork and environment flags have no changes in this release. No deployment or new live transaction was needed.
- These results are automated/local UI evidence. Manual Phantom verification and normal V6 activation remain pending. Replay-value feedback after multiple hunts is still needed.

## Future separate rules version — extraction competition

The original proposal below is retained as a future design, not instructions to implement on top of V5/V6. Its early extraction, loss on death/timeout and room-specific payouts conflict with existing hunt settlement. A future version needs separate versioned state/instructions and a recovery strategy preserving all existing pending requests and reservations.

Before implementation, resolve:
- Authority for movement, time, damage and timing challenges; a browser-supplied score is insufficient.
- Fair treatment of wallet approvals, delayed VRF and connection interruptions during timed play.
- Fixed-seed competition versus luck-inclusive rankings, eligibility and replay protection.
- Inventory purpose: three single-item doors and three slots cannot naturally overflow, so the proposed swap mechanic currently has no meaningful trigger.
- New payout/reservation arithmetic, proof formats, settlement and upgrade verification.

The original Phase 5/6 ER and VRF proof work must reuse and audit the existing integration rather than restart it. New gameplay still requires independent verification. No future phase is authorized by completing the Daily Route.

---

# Preserved original extraction proposal

# Loot or Lose — Six-Door Dungeon Gameplay Upgrade

**Purpose:** Implementation instructions for Codex, beginning from the existing six-door Phaser map and an existing Anchor project. **Do not rebuild the map or reinitialize Anchor.**

**Goal:** Make a playable, fair, three-minute, single-player extraction competition with repeatable runs and eventually independently verifiable settlement on Solana.

**Important:** This document is a proposed specification, not a description of functionality already implemented. Codex must inspect the repository and report what actually exists.

## 0. Read-first instructions for Codex

1. Inspect `AGENTS.md`, `idea.md`, `requirement.md`, `setup.md`, the current Phaser scene, tilemaps/assets, Anchor programs, tests, and `Anchor.toml`.
2. Produce a **baseline inventory** of existing working features, project commands, and tests. Do not delete working code or change dependency versions without justification.
3. Preserve door positions and IDs **01–06**, the existing player sprite, walls, collisions, and map scale unless an explicit change is needed.
4. Work on **one phase at a time**. After each phase run the relevant tests, report the exact commands/results, and stop. Do not proceed until approved.
5. Separate `local-demo` (explicitly labeled simulated outcomes) from `verified` (authoritative backend/contract). Never display a mock result as a VRF result or simulate onchain success.
6. Persist completed phase notes at `docs/phase-log.md`: summary, files changed, commands run, results, known issues, next gate.
7. Use strict TypeScript, modular testable logic, deterministic fixtures, and minimal dependencies. No wallet keys in source control.
8. No paid staking, real-money prizes, cash redemption, or promises of monetary returns; use demo gold and Solana devnet where relevant.

## Game rules — lock before implementation

- Run time **180 seconds**; starts on entry after a deliberate Start action, not when the page loads.
- **100 max HP**, initial HP 100. HP clamps to [0,100]. At HP 0 the run fails immediately.
- **3 inventory slots**. Every loot item takes one slot, unless explicitly marked `consumable` and immediately applied. Never add an item if capacity is exceeded; instead show a swap/leave choice.
- **Maximum three treasure doors opened** per run, even if the player has empty slots or healing. An opened door cannot be reopened or rerolled.
- Player must **travel to a visible extraction portal**, interact and hold for **2 seconds** to extract. No instant extraction from anywhere.
- Successful extraction banks the sum of carried loot's **fixed demo-gold values**. Failed/timed-out runs bank **0**. No negative values.
- Extraction freezes the run and prevents duplicate reward submissions; leaderboard updates only from accepted final outcomes.
- For tournament rankings: highest banked gold wins; tie: lowest elapsed time; further tie: stable deterministic run ID. Also display survival rate and rooms opened for engagement, but not as winner criteria.
- **Competitive fairness:** identical layout and same published/committed challenge seed for official tournament participants; unique reward claims per run and one eligible official entry per wallet per event. Wallet uniqueness is not Sybil resistance—do not claim it is.
- **Game physics, animation, and camera** are local Phaser concerns; **eligible reward-bearing actions** need independent validation.

## Room configuration (provisional tuning; all values in fictional gold)

| Door | Type | Hint before opening | Action on open | Possible outcome | Design purpose |
|---|---|---|---|---|---|
| 01 | Safe Vault | Low risk | Open chest | Common relic, 20–40 gold | Guaranteed beginner option |
| 02 | Trap Vault | Hazard | Avoid timed spike cue | 45–90 gold; failure costs 20 HP | Timing pressure |
| 03 | Healing Vault | Recovery | Pick one option | Heal +30 HP (cap 100) **or** take 15–25 gold | Opportunity cost |
| 04 | Cursed Vault | High risk | Accept curse or retreat | 80–140 gold; curse costs 15 HP on next door opening | Future consequence |
| 05 | Mystery Vault | Unknown | Open chest | 10–120 gold from disclosed tier table | VRF integration candidate |
| 06 | Legendary Vault | Extreme risk | Complete short timing challenge | 150–250 gold on success; failure costs 35 HP and no item | High reward/skill gate |

Room values are **proposed balancing constants**, not market prices. Define them in a single shared config file. The displayed hint must not reveal an outcome. For official runs, use precommitted deterministic challenge configurations or verifiable VRF outcomes; don't substitute `Math.random()` for claimed verification. If a consumable reward is chosen in room 03, it still counts as one of the three doors.

## Recommended structure (adapt to existing repository; do not force a rewrite)

```text
src/game/scenes/DungeonScene.ts
src/game/config/rooms.ts
src/game/core/types.ts
src/game/core/runState.ts
src/game/core/roomResolver.ts
src/game/core/extraction.ts
src/game/core/score.ts
src/game/ui/Hud.ts
src/game/ui/RoomInteractionPanel.ts
src/game/ui/RunResultPanel.ts
src/game/adapters/LocalGameAdapter.ts
src/game/adapters/VerifiedGameAdapter.ts
src/game/net/ActionGateway.ts
src/game/__tests__/...
programs/<existing-anchor-program>/src/lib.rs
scripts/... (optional)
docs/phase-log.md
```

Use an action/reducer style `applyAction(state, action)` for rules, with the render layer as a consumer of state. Use enums or string unions for `runStatus: idle | active | extracting | extracted | failed | expired`, `roomStatus: unopened | opened`, and `mode: local-demo | verified`.

## Phase 0 — Audit and baseline (no gameplay changes)

**Goal:** Understand existing code and get a reproducible baseline.

**Actions**
- Locate the existing Phaser scene, six door entities, collision layer, movement input, HUD, Anchor programs, and tests.
- Determine how current door overlaps and interactions are implemented; document door IDs and coordinates.
- Record how to launch app, build Anchor, run tests, and any blockers.
- Create `docs/phase-log.md` and a short `docs/architecture.md` if absent.

**Acceptance gate:** Existing map still loads. No gameplay behavior changed. Commands and failures reported honestly.

**Codex prompt:**
> Read AGENTS.md and all project documentation. Audit the existing six-door dungeon and Anchor code without modifying gameplay. Record the map scene path, door IDs and coordinates, movement/collision system, dev/test/build commands, and currently working blockchain functionality. Create docs/architecture.md and docs/phase-log.md. Run baseline tests/build if available. Stop and report GO/NO-GO; do not start Phase 1.

## Phase 1 — Data-driven rooms, HP, inventory and interactions

**Goal:** Make the existing six doors meaningful and testable in local-demo mode.

**Actions**
1. Add a typed `RoomDefinition` map keyed by `01`…`06`. No scattered door-specific branching in the scene.
2. Add run state: `runId`, `startedAt`, `hp`, `inventory[]`, `openedDoors[]`, `doorLimit=3`, `unbankedGold`, and status.
3. Use `E` to interact only when within an explicit radius and line-of-sight/no wall obstruction. Show a hint before opening.
4. Implement one-time room resolution with deterministic test fixtures; show outcome and HP/inventory changes.
5. For item overflow, present a **Leave / Replace** choice; replacement doesn't change slot count. A replaced item is forfeited.
6. Display readable HUD for HP, 3 inventory slots, rooms remaining, unbanked gold, and interaction prompts.
7. Store exact door IDs and consumed status in run state; prevent rapid repeated keypresses from granting duplicate rewards.

**Tests:** room config has exactly six unique IDs; HP clamping; cannot open fourth door; same door only once; full inventory cannot silently overflow; healing cannot exceed 100; duplicate E press cannot double grant; remote doors not actionable.

**Acceptance gate:** Each room opens once, visibly does something different, and all rule tests pass. No purported real-chain functionality.

**Codex prompt:**
> Implement Phase 1 only, using the existing map and scene. Create typed, data-driven definitions for doors 01–06 with the room types and balancing table in this document. Implement 100 HP, three inventory slots, three-door maximum, E proximity interaction, explicit leave/replace overflow, and an updated HUD. Use seeded local-demo fixtures and label them. Preserve movement, wall collision, and visuals. Add unit tests for state invariants and interaction guards. Run tests/build, update docs/phase-log.md, explain code flow, and stop.

## Phase 2 — Timer, extraction portal, game-over and replay

**Goal:** Establish a complete local extraction loop.

**Actions**
1. Add Start Run control; start a 180-second authoritative game timer in demo mode (not tied to Phaser frame rate or tab refresh alone).
2. Add a visible extraction portal to a reachable place on the current map (choose coordinate after inspecting tile collision data; never place in a wall).
3. Exit requires entering portal radius and holding `E` for 2 seconds; release/collision loss cancels progress.
4. Transition `active -> extracting -> extracted` exactly once; record banked loot and elapsed time.
5. At HP=0 or timer=0 transition to `failed`/`expired`, set banked value to 0, block interactions.
6. Add end-run modal with cause, time, rooms opened, items extracted or lost, banked gold, and **Play Again** with completely fresh run state.

**Tests:** timer expires exactly once; zero HP fails; no extraction away from portal; extraction interrupted before two seconds; extraction resolves once; replay resets all room states and effects; no post-game action mutates loot.

**Acceptance gate:** Player can start, loot, voluntarily extract, fail, and replay without reloading. No double rewards.

**Codex prompt:**
> Implement Phase 2 only. Add a 180-second run timer, reachable extraction portal, 2-second hold-to-extract, failure on 0 HP or timeout, final results modal, and clean replay. Use explicit run-state transitions and once-only settlement logic in local-demo mode. Do not add enemies or blockchain integration. Write state-transition tests, run build/tests, update phase log, explain flow, and stop.

## Phase 3 — Meaningful hazards and three-door strategy

**Goal:** Add tension without introducing a large combat system.

**Actions**
1. Implement a single patrolling slime (10 HP collision damage) and one telegraphed periodic spike hazard (20 HP), both respecting invulnerability frames/cooldown to avoid instant death.
2. Add 1–2 strategic obstacles/shortcuts **only if** they preserve all door/exit reachability.
3. Door 02 timing trap, door 04 delayed curse, and door 06 short skill check must have deterministic input/result rules. Avoid unvalidated frontend-only score claims in verified mode.
4. Make danger escalation time-based: 180–91s normal; 90–31s faster hazard cycles; 30–0s escape warning. Avoid spawning many agents.
5. Show player feedback: damage flash, hazard cue, curse status, chest obtained animation, and countdown warnings.

**Tests:** damage cooldown; curse applied exactly once on next door; safe vault cannot cause hazards itself; all doors remain reachable; no trap triggering while paused/results are shown; seeded actions produce same outcome.

**Acceptance gate:** A player can finish in 2–3 minutes; at least two materially different sensible routes exist; no soft locks.

**Codex prompt:**
> Implement Phase 3 only. Add one slime, one spike hazard, clear danger cues and cooldowns, room 02 timing trap, room 04 delayed curse, and room 06 skill gate. Add time-based danger escalation and accessibility feedback. Preserve current tile map unless a small reachability fix is necessary. Add deterministic tests. Do not implement PvP, networking, NFT marketplace, or blockchain yet. Run tests, record results, and stop.

## Phase 4 — Competitive solo leaderboard (local, then authoritative)

**Goal:** Create a visible reason to replay without claiming wallet uniqueness or cryptographic fairness.

**Actions**
1. Tournament mode uses one fixed map and a seeded challenge schedule; provide practice mode separately.
2. Define one eligible official entry per wallet per tournament **but acknowledge that wallets are not unique people**; consider rate limiting and event registration.
3. Calculate banked gold only on successful extraction. Sort by banked gold descending, elapsed milliseconds ascending, run ID ascending.
4. In local-demo mode, leaderboard is explicitly demo data; do not use client-supplied scores for prizes.
5. Build leaderboard/results UI, show other players' verified statuses, and a clear practice/official distinction.

**Tests:** zero for failure; valid sorting and ties; duplicated submission ignored; official/practice separation; one accepted run per registered wallet/event; malformed score rejected in authoritative mode.

**Acceptance gate:** Leaderboard ordering deterministic and users cannot edit a frontend value to create an accepted official result.

**Codex prompt:**
> Implement Phase 4 only. Add practice versus official tournament modes, fixed challenge seed, leaderboard score and deterministic tiebreaks, separate demo data and verified results. Do not trust browser-submitted banked gold. Implement duplicate-run protection and tests. If no authoritative service/program exists yet, leave official submission disabled with a truthful explanation. Run tests and stop.

## Phase 5 — Authoritative actions and MagicBlock ER proof

**Goal:** Connect actual high-value game transitions to secure state; do not attempt to put every Phaser animation onchain.

**Actions**
1. Inspect the **installed** MagicBlock SDK and official docs/examples for the current Anchor delegation/commit/undelegation flow; do not invent method names or assume the current example version.
2. First implement an **isolated proof**: create game state on Solana devnet, delegate supported account(s), perform an ER state update, commit and finalize as specified by current SDK; capture transaction signatures, program IDs, and actual confirmed state changes.
3. Design server- or program-validated actions: `start_run`, `open_room`, `resolve_challenge`, `take_damage`, `extract_run`. Bind to wallet, run ID, current status, and monotonic action nonce. Validate proximity or a verifiable movement/checkpoint path; do not accept naked “I reached door 06” assertions.
4. Keep Phaser frame-by-frame movement local. Only verified actions change collectible-eligible state.
5. Integrate the proof into one complete demo path: enter -> open ONE verified room -> extract -> final result on Solana.
6. Handle RPC errors, rejected actions, delayed commit, retries, reconnection, and duplicate messages in UI and tests.

**Tests:** replayed action rejected; wrong wallet rejected; opening locked/unreached room rejected; extraction repeated rejected; commit confirmed on base Solana; frontend cannot alter final banked amount.

**Acceptance gate:** Real ER transaction(s), real base chain finalization, independently inspectable on explorer. If blocked, document the blocker and preserve the local game; **do not label local demo as onchain**.

**Codex prompt:**
> Implement Phase 5 only after auditing existing Anchor code and the installed MagicBlock dependencies. First prove initialize/delegate/ER update/finalize using the exact supported SDK. Show confirmed transaction signatures and state before/after. Then connect one verified chest and extraction flow. Add authorization, run status, action nonce, and validation for location-sensitive actions. Never trust browser-provided loot/HP/score; never fake transactions. Run integration tests on the supported cluster and stop with GO/NO-GO.

## Phase 6 — MagicBlock VRF and fair loot

**Goal:** Replace mock randomness with verifiable outcomes, only after ER lifecycle works.

**Actions**
1. Find current official VRF request/fulfillment flow and whether it composes with the chosen ER architecture; document supported account/authority requirements and any callback limitations.
2. Publish loot tier table and map VRF bytes to outcomes without modulo bias where relevant. Guard against rerolls by persisting each door's resolution and nonce.
3. Show pending randomness state and robust timeouts/retry semantics; never silently substitute pseudorandom output in verified mode.
4. For tournament fairness choose either identical deterministic challenge seeds for all official players **or** a luck-inclusive ranking; document this clearly.

**Tests:** fulfillment cannot be replayed; valid callbacks only; correct loot distribution boundaries; no reroll; timeout UI; same committed input cannot produce conflicting claimed outcome.

**Acceptance gate:** At least one treasure reward traceable to real VRF fulfillment. If integration is blocked, keep explicit local-demo mode and ship working ER run.

**Codex prompt:**
> Implement Phase 6 only. Read current official MagicBlock VRF example. Integrate verifiable chest randomness with clear onchain proof, published prize weights, replay protection, and correct pending/timeout handling. Ensure it works with current ER setup or document incompatibility. Do not fake VRF; test callbacks and rounding/bias handling; stop after reporting actual results.

## Phase 7 — Polish, demo and submission

**Goal:** A judge can understand, play, and verify a complete run quickly.

**Actions**
- Onboarding overlay: move (WASD/arrows), interact (E), 3 doors max, 3 item slots, 180-second timer, portal extraction.
- Status icons for Safe/Trap/Healing/Cursed/Mystery/Legendary, visible 3-door counter and loot total.
- Color-blind-friendly cues: icons + labels, not color alone; keyboard support and sensible text contrast.
- Record ~60–90 second demo: connect wallet -> start -> open room -> take risk -> extract -> view confirmed transaction -> leaderboard.
- Run e2e checks on primary browser, fresh wallet, slow RPC, no wallet, disconnected wallet, duplicate click, page refresh.
- Document actual status: verified ER, VRF, collectible minting, or omitted features. Never overclaim.

**Acceptance gate:** Reproducible demo and honest README with commands, network IDs, limitations and links to verifiable transactions.

**Codex prompt:**
> Implement Phase 7 polish and submission preparation only. Create concise onboarding, accessibility improvements, robust feedback for network delays and errors, and a README with actual commands and confirmed feature status. Run end-to-end happy/failure paths and list exact tests. Produce demo script and submission checklist. Do not claim unverified blockchain functionality.

## Priority and cutting rule

**If time is short:** Complete Phases 0–2, then Phase 5 ER proof, then Phase 4 minimum verified leaderboard; only afterward add Phase 3 polish/hazards and Phase 6 VRF. One verifiably settled extraction loop beats many unverified mechanics.

## Standard report expected at the end of EVERY Codex phase

```text
Phase:
Goal achieved:
Files created/changed:
Commands run (exact):
Tests passed/failed:
Manual play-through performed:
What happens when a player acts (plain English):
Security/trust assumptions:
Known issues:
GO/NO-GO and reason:
Next phase (not started):
```
