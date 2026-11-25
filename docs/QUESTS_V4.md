# Six independent quests — V4

The landing page now opens a six-quest dungeon. Choose $1–$100 in fictional demo credits at the start, then hunt any quest. Exploration is local and immediate after the stake is reserved. The stake does not preselect a quest. Approach any guardian, review its odds if desired, and explicitly choose **Attempt quest**. A resolved attempt must settle before another stake can be reserved. Returning to the dungeon preserves the local exploration position.

| ID | Quest | Position | Return including stake | Success odds |
|---|---|---|---|---|
| 0 | Copper Watch | (4,2) | 1.25× | 19/25 (76%) |
| 1 | Silver Sentinel | (3,7) | 1.5× | 19/30 (63⅓%) |
| 2 | Emerald Maw | (8,7) | 2× | 19/40 (47.5%) |
| 3 | Obsidian Keep | (8,2) | 2.5× | 19/50 (38%) |
| 4 | Crown Vault | (12,2) | 3× | 19/60 (31⅔%) |
| 5 | Dragon Hoard | (12,7) | 5× | 19/100 (19%) |

Each attempt is independent. Every quest can fail for zero return. All six have 95% theoretical return before cent rounding. There is no sequential extraction ladder in V4. No real deposits, cash payouts or redeemable tokens are implemented.

## Deployment status

**V4 is implemented locally and is not deployed or verified live.** `NEXT_PUBLIC_QUEST_V4_ENABLED=false` is the default. Practice uses browser rejection sampling and makes no VRF claim. Do not enable V4 devnet until the rebuilt binary has been deployed and the real lifecycle has been verified.

The local ELF now contains V4 and differs from the previously deployed V3-only binary. Binary-comparison verifiers should refuse live sends until the matching program is deployed. Existing live V3 evidence remains historical evidence for V3, not V4.

## Versioned program boundary

V4 adds `QuestHouse`, `QuestPlayer`, `QuestTicket`, `QuestAttempt` and `QuestPhase`. Its seeds are `quest_house_v4`, `quest_player_v4`, `quest_ticket_v4 + wallet + index`, and `quest_attempt_v4 + wallet + index`. Rules version is 4. Existing V1/V2/V3 account layouts and instructions remain available.

The stake-first flow calls `create_quest_attempt(index, stake, 255, [])`, where 255 means no quest has been chosen. Creation debits the player, adds the stake to the house and reserves the largest possible payout (5×). `risk_quest(index, nonce, quest_id, approach_path)` validates at most 64 legal steps from (1,1) and adjacency to the chosen guardian, then binds the runtime quest to this single request. Tickets remain immutable with the unchosen marker; settlement validates the selected quest and the reserved maximum. The program also retains preselected-quest creation for compatibility with earlier local V4 fixtures. The invariant remains `house.balance >= house.reserved`.

One unresolved attempt per V4 wallet is enforced. V4 has a separate one-time $100 demo allocation; it does not migrate V3 balances. The browser checks for an active V3 run before V4 preparation and directs the player to `/recovery`. This cross-version check is a browser guard; the program enforces active-attempt exclusivity separately within each ledger version.

Creation and delegation use base devnet. Authorization and risk requests use the router-resolved ER. The existing four-minute session signer has no ledger authority and is bound to the attempt. The authenticated callback matches attempt/index, quest and request nonce, stores the VRF bytes, and freezes success or zero. The callback checks the runtime quest against the requested quest; settlement checks the immutable ticket reservation and the resulting payout.

Finalization commits and undelegates the attempt. Base-layer settlement verifies the terminal state, ticket and exact payout before crediting the player and releasing the reserve. Duplicate settlement cannot pay twice. The browser shows a settled result only after the base ticket confirms.

## Recovery and verification

The existing signed-transaction journal preserves signature, endpoint and block expiry before upload. Unknown confirmations block dependent actions. Reload discovers the wallet's active V4 attempt. Session private keys stay in memory; reload requires a new authorization for an unrequested attempt. Pending randomness has no reroll, automatic loss or outage refund. After 60 seconds the UI offers practice with a separate balance; returning to Devnet resumes observation of the same request.

The proof dialog recomputes the selected quest's sampling threshold from persisted account bytes. It links to the attempt account, not an assumed callback transaction. V4 uses the same rejection-sampling algorithm as V3, with independent quest odds.

```bash
NO_DNA=1 anchor build --ignore-keys
NO_DNA=1 cargo test -p loot_or_lose --tests
cd app
npm run lint
npm run build
npm test
```

`npm run verify:devnet-quests` compares the local ELF with the deployed program without sending transactions. After an authorized matching deployment, `npm run verify:devnet-quests -- --send --quest=0` uses the configured CLI wallet for at most 12 distinct $2 demo attempts, settling each before creating another. Each session needs a 0.002 devnet SOL top-up plus network fees. It resumes active attempts, recognizes existing success/failure evidence for the selected quest and never forces outcomes. CLI evidence does not replace a fresh-wallet browser check.

Program tests use controlled callback fixtures, not live VRF. Browser recovery tests intercept all RPC and never send fixture-wallet transactions to devnet. Release checks still require matching deployed bytes, actual authenticated VRF callbacks, success/failure settlement and a fresh-wallet browser pass.

## Interface

The main V4 page occupies `100dvh`. The HUD shows Outcome: Unrevealed until a result is known; multipliers stay in the optional odds review and result views, not the live HUD. Desktop uses a board beside an action panel; phones place the board above controls and actions. Quests/odds, stake entry, proofs, results and technical details use native dialogs that scroll internally. Keyboard focus and Escape dismissal are preserved. The supplied logo and hero ship from `app/public/brand/`; local `pictures/` stays ignored.
