# V5 — stake once, hunt three

The default experience is welcome → stake → explore six quests → open three different quests → collect loot. Stakes are $1–$100 in fictional demo credits. All six guardians share one reward pool; choosing a location does not change the reward distribution. Opened quests are unavailable for the remainder of the hunt. Zero rewards do not end a hunt or remove previous loot.

| Reward / original stake | Probability | Sample buckets |
|---|---|---|
| 0 | 40% | 0–39 |
| 1/4 | 30% | 40–69 |
| 1/2 | 20% | 70–89 |
| 1 | 8% | 90–97 |
| 5/3 | 2% | 98–99 |

Each reward is floored to cents independently. These are total returns including the stake contribution, not profits plus a stake refund. Three independent reveals average **86.5% of the original stake before rounding**: `3 × (0.30/4 + 0.20/2 + 0.08 + 0.02×5/3)`. The original proposal incorrectly called this 95%; the user explicitly chose to retain the table and correct the label.

The HUD shows stake, opened count and only loot already revealed (initially Unrevealed). Quest confirmation shows no odds or multipliers. The optional Reward rules dialog discloses the complete distribution, rounding, cancellation and collection rules. Rewards settle only after all three reveals. Before the first request, cancellation freezes a full refund for settlement. After requesting any reveal, there is no early collection, refund or reroll.

## Versioned program boundary

V5 adds HuntHouse, HuntPlayer, HuntTicket, HuntAttempt and HuntReveal, using `hunt_house_v5`, `hunt_player_v5 + wallet`, `hunt_ticket_v5 + wallet + index` and `hunt_attempt_v5 + wallet + index`. V1–V4 accounts and instructions retain their layouts. V5 grants a separate one-time $100 demo allocation, with one unresolved V5 hunt per wallet. Browser checks block entry while an earlier V3/V4 run is unresolved; this is not a cross-version program lock.

`create_hunt_attempt(index, stake)` debits the stake and reserves `3 × floor(5 × stake / 3)` of house credits. House balance includes the deposited demo stake and must remain at least the total outstanding reservation. No real asset custody exists.

`risk_hunt(index, expected_nonce, quest_id, approach_path)` validates at most 64 legal steps from the hunt's last confirmed position (spawn initially), requires adjacency to an unopened quest, and atomically records a single pending request with its VRF CPI. Exploration between reveals remains local and immediate. Only a valid approach is submitted; no RPC movement loop is needed.

The authenticated `resolve_hunt(randomness, index, request_nonce, quest_id, reveal_index)` callback checks pending phase, nonce, selected quest and reveal index. It uses the shared unbiased rejection sampler with denominator 100, persists the bytes, bucket and integer reward, marks the quest opened and increments the total. After three reveals it freezes Complete; otherwise it returns to Active. Session signers remain bound to the hunt and have no ledger credit authority.

Finalization commits and undelegates only Complete/Cancelled accounts. Base settlement recomputes every persisted reward and the sum, validates distinct quest IDs, count, mask, stake, version and reservation, then credits exactly once. Cancelled hunts must have no request nonce, reveals or opened quests. The UI reports confirmed credit only after the base ticket confirms.

## Recovery, proofs and practice

Reload restores the active V5 hunt and its reveal history from the authoritative routed runtime. Existing transaction journaling blocks duplicate submissions after ambiguous confirmations. Session keys stay in memory; reauthorize an active hunt after reload or expiry. Pending randomness locks the same request indefinitely; after 60 seconds recovery and separate-balance practice fallback are available. Returning to devnet resumes observation without creating a replacement request.

The proof ledger recomputes each persisted sample, reward, distinct-quest mask and summed return. It links to the hunt account and does not claim to verify the oracle signature in the browser.

Practice has no VRF claim or blockchain receipt. Three independent browser draws are fixed when the hunt starts, kept out of the HUD, and retained in session storage alongside practice balance and progress. Reload during a reveal finishes that same draw rather than choosing another. Browser state is inspectable and editable; it is fictional practice, not an authoritative ledger.

Historical interfaces remain at `/recovery` (V3) and `/recovery/quests` (V4). Their earlier rules apply only to those accounts.

## Rollout and verification

`NEXT_PUBLIC_HUNT_V5_ENABLED=false` is the default. V5 has not been deployed or verified live. Enable only after the deployed binary matches this build, authenticated real VRF reveals include zero and positive rewards, settlement is confirmed, and a fresh-wallet browser lifecycle passes. Existing V3 evidence and mocked tests do not verify V5.

```bash
NO_DNA=1 anchor build --ignore-keys
NO_DNA=1 cargo test -p loot_or_lose --tests
cd app
npm run lint
npm run build
npm test
```

`npm run verify:devnet-hunts` is a read-only binary comparison. Explicit `--send --quests=0,1,2` enables up to 12 ordinary $2 demo hunts with the configured CLI wallet, session funding (0.002 devnet SOL each) and transaction fees. It resumes partial/pending hunts, settles before creating another and recomputes all proofs. It never forces a prize or rerolls a request. Do not run live sends before an authorized matching deployment.

Program tests use controlled callback fixtures in LiteSVM; signature verification is disabled only for those fixture callbacks. Request-transition unit checks and session rejection tests do not replace a successful live VRF CPI. Browser fixtures intercept RPC and do not send real devnet transactions. Viewport checks cover 375×667, 768×900, 1280×720 and 844×390, including reduced motion and dialog focus.
