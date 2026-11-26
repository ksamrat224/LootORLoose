# V6 — smoother loot, practice first

New practice hunts use V6. Existing practice and devnet hunts keep the `rules_version` stored when created. Devnet still creates V5: `NEXT_PUBLIC_HUNT_V6_ENABLED=false` by default. The compatible V6 binary is built locally, **not deployed**. Historical V5 live evidence does not verify this new binary.

| Share of original stake | Probability | Buckets |
| --- | --- | --- |
| 0 | 10% | 0–9 |
| 1/4 | 30% | 10–39 |
| 2/5 | 59% | 40–98 |
| 3/4 | 1% | 99 |

Each reveal is an independent unbiased 0–99 draw. Floor each reward to cents separately. Three reveals average `3 × (0.30/4 + 0.59×2/5 + 0.01×3/4) = 95.55%` of the original stake **before rounding**. Exhaustive enumeration of one million draw triples yields 546,270 profits (54.627%), 451,930 losses (45.193%), 1,800 break-even outcomes (0.18%) and 1,000 all-empty outcomes (0.1%), before rounding. Rounding can turn a break-even hunt into a small loss; these frequencies are not guarantees. Repeated play still reduces demo credits on average.

For a $2 stake the per-chest amounts are $0, $0.50, $0.80 or $1.50. Three ordinary $0.80 chests return $2.40, a $0.40 profit. A $0.80, $0 and $1.50 hunt returns $2.30, a $0.30 profit. Rewards include the stake contribution; there is no extra stake refund after completion.

## Compatibility and interfaces

`create_hunt_attempt_v6(index, stake)` creates rules version 6; the original `create_hunt_attempt` continues creating version 5. Account structures, discriminators, PDA seeds, index sequence and ledger allocation are unchanged. V6 uses the existing hunt ledger and receives **no second allocation**. One unresolved hunt per wallet remains enforced across both versions.

Reserve `3 × floor(3 × stake / 4)` at V6 creation. V5 retains `3 × floor(5 × stake / 3)`. Callback, cancellation, session authorization/revocation, request and settlement handlers accept only supported versions and use the immutable stored version. Pending callbacks retain their request nonce and original payout semantics. Settlement recomputes all three rewards, validates the matching reservation and credits once. There is no forfeiture, timeout refund or new abandoned-hunt policy.

Client `huntReward(stake, bucket, rulesVersion)`, `huntReserve(stake, rulesVersion)` and `rewardRules(rulesVersion)` require an explicit version and reject unsupported versions. Proofs include that version when recomputing rewards and totals. Devnet scripts consume the same decoded version and proof verifier; they do not infer rewards from a current default.

Practice keeps the existing `loot-hunt-v5-practice` storage key to retain balances, saved V5/V6 hunts and pending draws. New hunts save version 6. Restoring an unresolved hunt never upgrades its rewards or rerolls it. Practice remains browser-editable fictional state, without VRF proofs or blockchain receipts.

## Practice review

- [ ] Start new hunts and confirm the optional Reward rules dialog shows V6, the four reward buckets and 95.55% before rounding.
- [ ] Play a varied sample without rerolling losses. Review reward pacing and report actual observed outcomes separately from theoretical statistics.
- [ ] Confirm quest popups and live HUD reveal no odds or future prizes; results distinguish return and net change.
- [ ] Reload after a reveal and during the next request: same balance, rewards, hunt version and pending draw.
- [ ] Confirm an existing V5 practice save still uses its 86.5% table through collection, then a new hunt uses V6.
- [ ] Review mobile/desktop controls, keyboard focus, reduced motion and result readability.

## Devnet release gate

Keep `NEXT_PUBLIC_HUNT_V6_ENABLED=false` during practice review. Existing `NEXT_PUBLIC_HUNT_V5_ENABLED` continues gating the hunt client generally. When V6 is disabled, combined preparation and standalone creation still encode the original V5 instruction; V6 account reads and recovery are not gated.

A later authorized release must deploy the compatible program, verify matching base/ER binary bytes, verify V5 pending-hunt recovery, then use an isolated V6-enabled client for fresh-wallet V6 creation, authenticated VRF reveals and exactly-once settlement. Check reservations, session revoke/recovery, proofs and real approval counts. Only then enable V6 for new devnet hunts. Public flags select client instructions; they are not program access controls.

No deployment, wallet signing, devnet funding or live release claims are part of this practice-first change. Manual Phantom and provider-outage checks remain tracked separately in the existing verification documents.

## Local verification — Nov 26, 2026

- `NO_DNA=1 anchor build --ignore-keys`: passed; generated IDL copied to the frontend. Existing account types/layouts and all prior instruction interfaces compare identically to the preceding revision; only V6 creation is added.
- `NO_DNA=1 cargo test -p loot_or_lose`: 37 passed, including every ordered three-quest choice under both versions, callbacks/replay, reservations, cancellation, session revocation and exactly-once crediting.
- `npm --prefix app test -- --workers=4`: 88 passed, including exhaustive V6 probability enumeration, both-version arithmetic for all 9,901 supported cent stakes, V5/V6 practice reload through collection, the V6 creation gate, proof rejection and four viewport sizes.
- Frontend lint and production build: passed.

These are local and mocked-browser checks. Practice feel review, V6 deployment, authenticated live V6 VRF and fresh-wallet devnet verification remain pending.
