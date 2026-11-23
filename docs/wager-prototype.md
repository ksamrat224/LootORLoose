# V3 demo wager prototype

Status: upgraded on devnet and live VRF success/failure settlements verified on Nov 23, 2026. This workspace's ignored `app/.env.local` enables V3; the example environment stays disabled by default. Original free-game receipt layouts remain unchanged. This is a demo-credit prototype, not a production or real-money release.

## Rules

One initial $100 demo allocation per wallet; no replenishment or redemption instruction. Stakes are 100–10,000 integer cents. Total returns include the stake. Gate odds are 19/25 → 5/8 → 2/3, paying floor(stake × 5/4), stake × 2, or stake × 3. Each fixed extraction strategy has a 19/20 theoretical return before rounding. Odds never depend on wallet identity, history, or bankroll balance.

Walking is validated tile by tile and never causes damage or financial timeout. A player explicitly requests the next gate while standing beside it. Extraction is available immediately after either of the first two successful gates. Gate three freezes 3× automatically; a failed gate freezes zero. Before any gate request, wallet-authorized cancellation freezes a full refund. A pending request prevents movement, extraction, cancellation, and another request.

## State and routing

All accounts are public and program-owned, except the expected base ownership change while gameplay is delegated. Versioned seeds preserve the original profile/run receipts.

| Account / seeds                            | Authority                                                                       | Runtime and persistence                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DemoHouse / demo_house_v3`                | Program arithmetic; one initialization                                          | Base only; starts with 1,000,000 demo cents; records balance and reserved liabilities                        |
| `DemoPlayer / demo_player_v3 + wallet`     | Wallet for creation and settlement                                              | Base only; one initial allocation, next index, one unresolved wager                                          |
| `WagerTicket / ticket_v3 + wallet + index` | Wallet + program constraints                                                    | Base only; immutable stake/reservation and one settlement marker                                             |
| `WagerState / wager_v3 + wallet + index`   | Wallet or that run's bound, valid session signer; authenticated oracle callback | Created on base; delegated for gameplay; terminal commit/undelegation returns its durable receipt            |
| Session token                              | Wallet and session program                                                      | Program-scoped, four minutes; V3 additionally binds the signer to one wager; no balance/withdrawal authority |

Creating a wager atomically debits the player, adds the stake to the house balance, and reserves 3× the stake. The invariant is `house.balance >= house.reserved`. The house account serializes concurrent reservations. No tokens or SOL stakes are moved.

Initialization, stake reservation, and delegation use base RPC. The router resolves each delegated wager's ER endpoint; movement, gate requests, wallet cancellation of delegated wagers, and final commit use that endpoint. Session authorization binds a temporary signer to that wager using the wallet. Queue/runtime availability is a live integration gate, not assumed from unit tests.

Terminal gameplay state freezes the payout. Finalization commits and undelegates only that state. A separate base transaction checks original account ownership, version, stake, terminal phase and payout, credits the player, releases the reservation, and marks the ticket settled atomically. Duplicate settlement returns without paying again. The UI never labels a result EXTRACTED/REFUNDED until the ticket and base receipt confirm the credit.

## Randomness and recovery

VRF request and fulfillment are distinct transactions. Requests use the SDK's scoped VRF identity and bind callback arguments to run index, gate, and monotonically increasing request nonce. The callback validates identity and PDA, requires exactly the pending request, records random bytes, and uses rejection sampling with hash expansion instead of a modulo-biased fallback. Duplicate or obsolete callbacks are rejected. There is no operator outcome setter or reroll instruction.

After 60 seconds without fulfillment, the UI displays a delayed-service state. The request stays pending. Recovery observes that same request; no automatic outage loss, refund, or replacement roll is implemented. Consequently an unavailable ER/oracle can lock a prototype wager until service recovers. Local practice uses separately labelled browser randomness and makes no VRF claim.

The client separates confirmed position, submitted movement, and unsent inputs. Interactions drain the movement queue before using the confirmed nonce. A transaction's signed identity is saved before upload; uncertain responses retain signature, endpoint, and block expiry across reload. Dependent actions stay blocked until a status/state read proves application, failure, or expiry. Session private keys remain only in memory, while the run and public recovery metadata survive reload. Wallet changes invalidate outstanding UI contexts.

## Verification

- `NO_DNA=1 anchor build --ignore-keys` then `NO_DNA=1 cargo test -p loot_or_lose --tests`.
- In `app/`: `npm run lint`, `npm run build`, `npx playwright install chromium`, `npm test`.
- Browser tests start isolated `.next-practice-tests` (port 3200, V3 disabled) and `.next-wager-tests` (port 3100, V3 enabled) dev builds. They do not depend on the user's ordinary server or local feature flag. Devnet tests use intercepted RPC fixtures; their disposable fixture wallet never sends to devnet.
- Program tests cover all payout tiers, exact RTP, flooring, cancellation, failure, insufficient balances/reserves, concurrent wallets, callback spoofing/mismatch/replay, walls/nonces, expiry/revocation and run-bound sessions. Fixture callbacks are not oracle integration evidence.
- Browser tests cover narrow/tablet/desktop layouts, stake entry, refund/extraction/loss, wallet disconnect/reload/rejection, ER outage, and uncertain submission retained across reload without resending. Transport tests separately verify pending/applied/failed/expired signature handling.
- Run `npm run verify:devnet-wager` for the live lifecycle check. It refuses to send if deployed program bytes differ from the local ELF. It recognizes settled V1-rules $2 receipts across interruptions and resumes any unresolved wager before creating another. Once both outcomes exist with no active wager, no new wagers are created. Existing free-game CLI evidence does not establish V3 browser or VRF reliability.

### Live V3 evidence — Nov 23, 2026

Program `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj` upgraded at slot **525323703**; [upgrade transaction](https://explorer.solana.com/tx/3CKwV6qmWZ3fPqpwMLcdcXm81YYHW1RGJE7AtoTnsqaymd7Z9GJjby55mvZD9xDSgzMyQ7huZKFGX5PWYdkB47Mr?cluster=devnet). Independently read ProgramData matched the local 551,272-byte ELF, SHA-256 `32326ab3aaab75db90ef761155cb5c2d507203973e2fcc26012c779f0f931804`.

Transactions used base `https://rpc.magicblock.app/devnet`, router `https://devnet-router.magicblock.app/`, and the router-resolved ER `https://devnet-as.magicblock.app/`. Initial session authorization preflight returned Custom101 immediately after upgrade; a later read-only simulation recognized `AuthorizeWagerSession` and passed. This is consistent with delayed ER program propagation, not proof of an infrastructure outage. Recovery reused wager 0 rather than charging another stake.

| Outcome | Wager address | Stake / total payout (demo cents) | Finalized base settlement |
| --- | --- | --- | --- |
| Gate 1 success, extracted | `EGF1ZnNMQzvVb3VqbyHAx9KSc97ays67XpRrBsYm3sJH` | 200 / 250 | [transaction](https://explorer.solana.com/tx/3KPj3dhsXu6zoQP6WVnKfAjLT3MXLexwx9pNfg2btz6U6hVFmFcXfLSxenvbvmEeEYDMYpbh4RwiL2BJiWGkRUWR?cluster=devnet) |
| Gate 1 failure | `EqSX6FZdnt3XL1SqdtAZt8zJLZfftGZeHgbiXXPF4Ugb` | 200 / 0 | [transaction](https://explorer.solana.com/tx/nkK1motETzXKZjiwPTY8HuxmJHkMKDKRd5aazoJ5Zb6byafaBYKAr9NSoRCdwF87mbmAHSRieSbkbWGXXHqfd3J?cluster=devnet) |

Actual authenticated `ResolveGate` callbacks were observed inside successful `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` CPI transactions on that ER:

- Success callback: `5oNE1Z986uTXG2AiqyjF11NZLB5WRWExzT9rM6rYQMvMHnPVuESmpt5xMjYJi78EjvShtrZKf7mGr4kvWvDbvTSJ`; persisted randomness `fbbf203d559ec610611d51a5bc56be1a5d5c6f8201ef1be027cdaa2aa7c72156`.
- Failure callback: `4WysFUFUzT3EGjApySnzcoKUPGaazLJkrbCVwyqxEnxNH1JkSqvWhgbQymVey92qWeKcYAiSJKiC2Kq86NpfrdHn`; persisted randomness `12cc756d34165d392a873e04f74c18072136c00809be50f49a86cab2d7f0f157`.

Across interrupted/resumed verification, wager indices 0–7 extracted 250 cents each; index 8 naturally lost and paid zero. No odds were changed and no gate was rerolled. Wager 2 was recovered after interruption using a new temporary session, then settled before creating wager 3. Final base state: player **10,200 cents**, house **999,800 cents**, reserved **0**, `active=false`, `nextIndex=9`; wallet **6.343075378 devnet SOL**. This finite sample is integration evidence, not an estimate or guarantee of returns.

Lint, TypeScript, and all 17 browser/transport tests passed after recovery tooling changes. Live CLI evidence verifies session signing, real callbacks, and base crediting, but does not replace a fresh-wallet manual browser run or real-outage recovery exercise. Those release gates remain open.

No real-money wagering, mainnet deployment, cash payout guarantee, security audit, or automatic infrastructure-outage refund is included. Real custody and a real-money release would require a separate design and review.
