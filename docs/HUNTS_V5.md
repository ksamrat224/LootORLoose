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

V5 was deployed and verified on devnet on Nov 25, 2026. `NEXT_PUBLIC_HUNT_V5_ENABLED=true` in the example environment enables it; unset or false still disables it. Deployed bytes match this build, real VRF includes zero and positive rewards, base settlement and duplicate-settlement safety passed, and a fresh-wallet browser lifecycle passed. See [live evidence and limits](DEVNET_V5_VERIFICATION.md); existing V3 evidence and mocked tests alone do not verify V5.

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

The separate live browser check is `npm run verify:devnet-hunts-browser -- --send`, against a local app started with `NEXT_PUBLIC_HUNT_V5_ENABLED=true` on port 3230. It uses real RPC with an automated Wallet Standard signer, funds a fresh test wallet with 0.05 devnet SOL, exercises reload/session recovery, three reveals, proofs, collection and cancellation, and returns remaining liquid SOL. It prints a public wallet tag; the signer can be reconstructed in memory from that tag and the same configured CLI key using HMAC-SHA256 with domain `loot-or-lose:devnet-browser:v1:`. No additional private key file is stored. Driver failures are not browser passes.

## November 26 integration update

Preparation batches optional ledger initialization, stake, session creation, hunt authorization and delegation into one base transaction, with deterministic preflight resource-limit fallback to two approvals. Keys remain in memory for four minutes; session funding is 0.002 devnet SOL, in addition to fees and account rent. Reload authorization still crosses base and ER and uses two approvals. Within the same tab, recovery retains the generated key and reuses its confirmed token after uncertain creation or rejected ER authorization; it does not fund a replacement automatically. Only public metadata is persisted.

Hunt state streams from the router-selected ER with a five-second watchdog and serialized 1.5-second fallback reads. Active reveals no longer wait for legacy-ledger or balance reads. Session controls remove the hunt signer on its current runtime before closing its base token, preserving an accepted VRF callback. Public metadata supports completing token closure after reload. The additional instruction changes no account layout. `NEXT_PUBLIC_HUNT_SESSION_CONTROL_ENABLED` is enabled only after matching deployment and live verification.

See [session/deployment evidence and the pending Phantom checklist](DEVNET_SESSION_VERIFICATION.md). `npm run verify:devnet-reservations` reports retained reservations without sending transactions or releasing them.
