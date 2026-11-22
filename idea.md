# Loot or Lose — Idea & Product Vision

**Project:** Loot or Lose (working title)  
**Event:** Solana Blitz V10 — Entertainment Finance  
**Target demo:** November 27, 2026  
**Status:** Proposed MVP, not yet implemented  
**Network:** Solana devnet; no real-money wagering

## One-line pitch

A 3-minute, top-down dungeon extraction game where players explore, discover verifiably randomized loot, and choose between escaping with collectible rewards or risking everything for a better haul. MagicBlock Ephemeral Rollups power authoritative game actions; extracted rewards settle to Solana.

## The player experience

1. **Connect** a Solana devnet wallet and enter a free dungeon run.
2. **Explore** a compact top-down map using keyboard controls.
3. **Open chests** and collect items with different rarity and *fictional* gold values.
4. **Survive** one simple enemy type and environmental traps; health persists during the run.
5. **Choose** to exit early or search deeper for more valuable loot.
6. **Extract** at an exit tile. Only a successful extraction makes the run's loot eligible for ownership rewards on devnet.
7. **Review** a run summary with verifiable transaction links and extracted inventory.

The central emotional loop: **“One more room — or cash out my progress?”** Here, “cash out” means locking in fictional in-game rewards, *not* receiving redeemable money.

## Why Entertainment Finance?

The player's inventory is an at-risk portfolio of fictional items. Every decision trades potential upside against a chance of losing unextracted loot. The game has resource allocation, risk management, collectible ownership, and a clear settlement point. It is **not** a financial investment product and should not promise profits, real stock ownership, or a cash return.

## MagicBlock fit

| Component | Purpose | MVP status |
|---|---|---|
| Ephemeral Rollups (ER) | Execute authoritative movement/room interactions, HP, and inventory updates on delegated game-state accounts | **Required** |
| Solana base chain | Initialize persistent player/run state; commit/undelegate game outcome; record extraction result | **Required** |
| MagicBlock VRF | Verifiable chest/loot selection using deterministic prize tables | **Stretch, after ER works** |
| Private ER | Hidden map details or confidential traps | **Out of MVP** |
| Onchain collectibles | Mint a badge/item representing a successfully extracted reward | **Stretch; fallback is a verified onchain inventory receipt** |

**Design constraint:** Local graphical movement may be predicted/rendered immediately in Phaser, but the client must never be authoritative for HP, loot, success, or settlement.

## MVP game rules (proposed; tune via playtesting)

- One seeded map, approximately 5–8 rooms, one entrance and one exit.
- One player per run; no matchmaking or PvP.
- A run lasts up to 180 seconds; timeout counts as failure.
- Player starts at 100 HP and with no loot.
- Three item tiers: common (10 gold), rare (40 gold), legendary (100 gold). Gold values are game scoring units only.
- Three to five chests per run. A chest may be claimed at most once.
- One simple enemy archetype with telegraphed movement/attacks; optional traps.
- Player dies at 0 HP: all **unextracted** loot is lost; previously extracted inventory remains unaffected.
- Reaching the extraction tile and confirming extraction before death/timeout finalizes the run.
- Fixed item pool, explicit probabilities, and anti-replay checks. If VRF is omitted for initial demo, label the loot process **non-verifiable demo randomness** and do not claim VRF integration.
- No deposits, paid entry, cash redemption, USDC stakes, yield, profit claims, or marketplace in V10 MVP.

## Differentiation from the organizer's extraction-dungeon example

The organizer supplied the genre concept, so **this is not an original category**. Our distinctive product direction is an explicit **risk-and-extraction economy** with transparent scoring, a verifiable end-of-run receipt, and a replayable three-minute decision loop. Future differentiators might include nonredeemable insurance credits, equipment preparation, and cooperative guild runs, but not in the five-day MVP.

## Audience and jobs-to-be-done

- **Hackathon judges:** Verify that ER changes genuine gameplay state and extraction settles on Solana.
- **Casual players:** Experience an understandable, high-stakes-feeling mini-game within three minutes.
- **Web3 game builders:** See a compact reference implementation of onchain game state, delegation, and extraction.

## Demo story (under 3 minutes)

1. Show connected devnet wallet and an initialized run.
2. Enter the dungeon and move to a chest; show the resulting authoritative loot update.
3. Take damage and display the live state change.
4. Make the visible choice to extract instead of entering another risky room.
5. Show settlement/commit confirmation and the resulting persistent reward or inventory receipt in an explorer.
6. Optionally show a second run ending in death, proving unsuccessful loot cannot be claimed.

## Success criteria

- A fresh participant can finish a run without developer help.
- At least one authentic ER-backed gameplay state transition is visible and auditable.
- A successful extraction persists the right result on Solana devnet.
- A dead/timed-out player cannot settle unextracted loot.
- Demo clearly distinguishes what is onchain, what is on an ER, and what is purely client-side.

## Risks / open product decisions

1. **Time:** Implementing even a single-player authoritative game is nontrivial in ~5 days. Cut map variety, graphics, and crafting before cutting real settlement.
2. **ER lifecycle:** State delegation/commit/undelegation must be tested end-to-end; don't assume a local state update is settled on Solana.
3. **Randomness:** VRF has asynchronous integration and transaction-flow requirements; first make fixed/demo loot work, then upgrade.
4. **User experience:** Repeated wallet approvals can spoil the real-time feel. Investigate documented session-key flow only if core settlement is stable.
5. **Economics:** Fixed loot valuations are scoring mechanics, not market prices. A redeemable item market is a separate product and legal project.
6. **Security:** Validate every command; never trust browser-submitted treasure values or HP.

## Post-hackathon possibilities (not promises)

- New maps and bosses; deeper item crafting and equipment loadouts.
- Nonredeemable pre-run protection and item sinks.
- Cooperative raids, guild ownership, and asynchronous challenges.
- Optional secondary trading **after** legal, security, and tokenomics review.

## References

- MagicBlock docs: https://docs.magicblock.gg/
- ER integration examples: https://github.com/magicblock-labs/magicblock-engine-examples
- ER SDK: https://github.com/magicblock-labs/ephemeral-rollups-sdk
- Hackathon build portal: https://build.magicblock.app/
