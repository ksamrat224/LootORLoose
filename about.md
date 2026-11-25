> Current gameplay is V5: stake once, hunt three different quests from six, and collect their combined random loot. See [HUNTS_V5.md](docs/HUNTS_V5.md). V5 is deployed and verified on devnet; see [live verification](docs/DEVNET_V5_VERIFICATION.md). V3/V4 recovery is preserved.

# Loot or Lose — V3 demo-credit dungeon

## What it is

**Loot or Lose** is a fast, top-down dungeon game built around a simple question: once you have won a reward, do you extract it now or risk it at the next gate for a larger return?

V3 is the core version of the project. It turns the dungeon into a three-gate, **demo-credit** risk loop backed by Solana devnet and MagicBlock. The player chooses a stake, explores safely, voluntarily requests a verifiably random gate result, and decides when to lock in a return. It is designed to make high-frequency game actions feel closer to a conventional game while preserving an independently verifiable final receipt on Solana.

> Important: V3 uses simulated, nonredeemable demo credits. It accepts no deposits, moves no user funds as a stake, and makes no cash, token, or real-world payout. Devnet SOL is needed only for transaction fees and temporary-session setup.

## The player promise

The experience is intentionally easy to explain:

1. Start with **$100.00 in demo credits** when a wallet first plays.
2. Choose a **$2**, **$5**, or custom **$1–$100** demo stake.
3. Walk to a guardian gate. Movement is safe: walking, delay, and map exploration cannot lose the stake.
4. Explicitly choose to risk the next gate.
5. After a win, either extract the current return or continue to the next gate.
6. A failed gate pays $0.00. A successful extraction is committed to Solana and credited only after the base-layer receipt is confirmed.

The emotional loop is **“keep the haul, or tempt the next guardian.”** The player controls every risk decision; there is no automatic progression through a gate.

## Published rules and economics

All calculations use integer cents. Returns include the original stake and are rounded down to cents where needed. The rules version and stake are frozen when a run begins.

| Gate | Conditional success chance | Total return after success | Player decision |
| --- | ---: | ---: | --- |
| 1 — first guardian | 76% (19/25) | 1.25× | Extract or continue |
| 2 — second guardian | 62.5% (5/8) | 2× | Extract or continue |
| 3 — final guardian | 66.67% (2/3) | 3× | Automatically freezes the reward |

For example, a $5.00 demo stake extracted after gate 2 returns $10.00 total: the initial $5.00 stake plus $5.00 demo profit. A failure at any gate returns zero.

Each fixed extraction strategy has a 95% theoretical return before cent rounding. This is public math, not a promise of a return for an individual run and not an operator-profit mechanism. Odds do not adapt to a wallet, play history, loss history, or house balance.

### Cancellation and pending randomness

- Before requesting the first gate, the player can cancel and receive a full demo-stake refund.
- Once a gate request is made, exactly that request must resolve before another risk, extraction, cancellation, or movement-dependent interaction can occur.
- If the randomness service is delayed for 60 seconds, the UI shows a recovery state. It checks the original request; it never creates a replacement roll, turns a network error into a loss, or silently refunds a pending gate.

## The game experience and UI

The primary screen is a dark-stone dungeon with treasure-gold calls to action, mint/teal extraction accents, compact HUD cards, and a playful top-down tile map. It is built for keyboard play but presents every critical choice as an accessible button.

### Start screen

The V3 start screen makes the important information visible before the player spends any demo credits:

- **Mode selector:** Local practice or Devnet wager.
- **Wallet area:** labels all balances as `DEMO CREDITS · NO CASH VALUE`; the devnet version includes wallet connection.
- **Published odds ladder:** three numbered gate cards, their probability, and their total-return multiplier.
- **Stake form:** $2 and $5 presets plus a decimal custom amount from $1.00 to $100.00, limited to two decimals.
- **Balance display:** current available demo-credit balance.
- **Route guide:** a three-step explanation of movement, gate interaction, extraction, and the pre-risk refund.
- **Setup feedback:** for devnet, the main Start run flow prepares the wager, delegates the game state, and authorizes a temporary gameplay session.

### Dungeon screen

The player sees the dungeon board beside a focused risk panel:

- Move with **WASD** or arrow keys.
- Press **E** near a numbered guardian, or use the matching Risk gate button.
- Safe exploration is immediate and responsive; confirmed checkpoints reconcile with the authoritative state in the background.
- The side panel always shows stake, available demo balance, current total return, and net profit if extracted.
- Once a guardian has been cleared, **Extract** and **Risk next gate** are presented together so the central choice is never hidden.
- After each resolved gate a **Proof of roll** card shows the VRF randomness bytes read from the wager account, the request-to-fulfilment time, and a **Verify this roll in your browser** button that reruns the program's rejection-sampling rule and reports the sample against the gate threshold.
- A pending gate becomes a clear **Randomness pending** state rather than a misleading success or loss state.
- Gate 3 automatically freezes the 3× result if it succeeds.
- Result cards distinguish a frozen result from a base-layer-settled result. `EXTRACTED`, `LOST`, and `REFUNDED` appear only when the appropriate state is confirmed.

Technical data is kept behind an expandable **Technical details** panel. It exposes the current lifecycle state, rules version, cents stake, gate, nonce, run address, routed ER endpoint, VRF request nonce, session expiry, transaction link, and whether the base credit is confirmed. This keeps normal play approachable while still making the Web3 proof inspectable.

### Local practice and devnet modes

| Mode | Purpose | Randomness | Persistence |
| --- | --- | --- | --- |
| Local practice | Learn the loop with no wallet | Browser simulation, clearly labelled | Browser-only balance/context |
| Devnet wager | The V3 authoritative prototype | MagicBlock VRF | Solana devnet run receipt and demo-credit settlement |

Local practice is deliberately separate from the live claim: it is playable without a wallet and never claims verifiable randomness. Devnet mode is enabled in this workspace after live verification; a fresh clone gets it enabled via `.env.example` once copied to `app/.env.local`.

## Why MagicBlock is central to V3

V3 uses MagicBlock Ephemeral Rollups (ERs) so gameplay can be responsive without treating the browser as the source of truth. Solana base layer remains the durable ledger and settlement layer.

```text
Wallet signs setup                         Temporary session signs gameplay
       │                                                 │
       ▼                                                 ▼
Solana base ── create wager / reserve max payout ──► MagicBlock ER
       │                                               │
       │◄── commit + undelegate terminal state ───────┘
       ▼
Base settlement: credit demo payout, release reserve, mark receipt settled
```

The lifecycle is:

1. **Prepare:** initialize the demo ledger if needed, validate balance, debit the demo stake, and reserve the maximum possible 3× total payout.
2. **Delegate:** delegate only the live `WagerState` to the router-resolved ER. The balance ledger remains on base Solana.
3. **Authorize a session:** a wallet signs once to bind a four-minute, program-scoped temporary signer to that single wager. A 0.002 devnet SOL top-up funds its transaction fees. The session cannot create a wager, change a stake, grant credits, or settle balances.
4. **Play:** the session signer submits movement, gate requests, and extraction actions to the resolved ER. Movement batches are bounded and every tile is program-validated.
5. **Resolve risk:** MagicBlock VRF performs a separate authenticated callback for the requested gate.
6. **Freeze and return:** extraction, loss, cancellation, or final-gate success freezes a terminal result; the state is committed and undelegated.
7. **Settle:** a wallet-authorized base-layer transaction verifies the terminal state, credits the demo payout once, releases the reservation, and marks the ticket settled.

## Onchain model and safeguards

V3 uses versioned PDA seeds, so the original free-game receipts do not need to be reinterpreted or resized.

| Account | PDA seed shape | Role |
| --- | --- | --- |
| `DemoHouse` | `demo_house_v3` | Simulated house balance and total reserved liability; initialized to 1,000,000 demo cents |
| `DemoPlayer` | `demo_player_v3 + wallet` | One initial 10,000-cent allocation, next run index, and one active-run marker |
| `WagerTicket` | `ticket_v3 + wallet + index` | Base-layer stake/reservation record and idempotent settlement marker |
| `WagerState` | `wager_v3 + wallet + index` | Delegated runtime state: authority, session signer, position, gate, nonce, request identity, randomness, and frozen payout |

Key protections:

- One unresolved wager per wallet.
- A new wager atomically debits the player and reserves 3× stake before gameplay begins.
- The house invariant is `house balance >= reserved liabilities`.
- Only the bound session signer may operate its active wager; it has no ledger privileges.
- Tile-by-tile movement prevents wall traversal and teleporting.
- One pending VRF request at a time; callbacks are bound to run index, gate, and monotonically increasing request nonce.
- Randomness is sampled without modulo bias using rejection sampling and hash expansion.
- Duplicate, unauthorized, mismatched, obsolete, or replayed callbacks are rejected.
- Final settlement is idempotent, so retries cannot credit the payout twice.

## Reliability and recovery design

The app treats a submitted transaction, an ER-confirmed state, and a base-layer settled receipt as different facts.

- Gameplay actions are serialized. A dependent action is blocked while the preceding action is uncertain.
- The client keeps confirmed position, submitted movement, and unsent input separately, then replays only safe remaining predictions after a checkpoint.
- A signed transaction identity, endpoint, and block expiry are retained before upload. Reload recovery checks whether the submitted action applied, failed, is still pending, or expired before it considers retrying.
- Reloads, session expiry, wallet changes, delegation propagation, and commit delays are reconciled from chain state.
- Temporary session keys live only in the open tab. The persistent wager/receipt remains recoverable, but reload may require authorizing a new scoped session to continue gameplay.
- A terminal run is not called extracted or refunded until the base-layer `WagerTicket` shows it was actually settled.

## Live devnet evidence

V3 is deployed at [`BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj`](https://explorer.solana.com/address/BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj?cluster=devnet). The Nov 23, 2026 upgrade was confirmed at slot `525323703`; its deployed ProgramData was compared directly with the local 551,272-byte ELF (`SHA-256: 32326ab3aaab75db90ef761155cb5c2d507203973e2fcc26012c779f0f931804`).

The following two live, session-signed outcomes were independently read back from Solana base layer after real MagicBlock VRF callbacks:

| Path | Run receipt | Stake | Final outcome | Base settlement |
| --- | --- | ---: | ---: | --- |
| Extract after gate 1 | [`EGF1…3sJH`](https://explorer.solana.com/address/EGF1ZnNMQzvVb3VqbyHAx9KSc97ays67XpRrBsYm3sJH?cluster=devnet) | 200 cents | 250 cents credited | [`3KPj…RUWR`](https://explorer.solana.com/tx/3KPj3dhsXu6zoQP6WVnKfAjLT3MXLexwx9pNfg2btz6U6hVFmFcXfLSxenvbvmEeEYDMYpbh4RwiL2BJiWGkRUWR?cluster=devnet) |
| Fail gate 1 | [`EqSX…4Ugb`](https://explorer.solana.com/address/EqSX6FZdnt3XL1SqdtAZt8zJLZfftGZeHgbiXXPF4Ugb?cluster=devnet) | 200 cents | 0 cents credited | [`nkK1…fd3J`](https://explorer.solana.com/tx/nkK1motETzXKZjiwPTY8HuxmJHkMKDKRd5aazoJ5Zb6byafaBYKAr9NSoRCdwF87mbmAHSRieSbkbWGXXHqfd3J?cluster=devnet) |

The live run used MagicBlock base RPC, the devnet router, and its Asia ER resolution. The authenticated `ResolveGate` VRF callbacks were observed within successful VRF-program CPI transactions. During the test, one interrupted wager was recovered using a new temporary session and settled before a new wager was created. Across the bounded sample, eight runs extracted 250 cents and one naturally failed; no odds were changed and no gate was rerolled. The final observed base state had no active wager and zero reserved liability.

## Verification coverage

The project has been tested at three layers:

- **Program tests:** payout math, cent flooring, each strategy's theoretical return, cancellation, failed outcomes, insufficient balances/reserves, concurrent reservations, authority/session limits, movement/nonces, callback spoofing/mismatch/replay, and idempotent settlement.
- **Browser and transport tests:** responsive stake UI, public odds, local result paths, wallet rejection/change, session renewal, reload recovery, delayed VRF, ER outage handling, and ambiguous transaction submission without duplicate sends.
- **Live devnet checks:** deployed ELF verification, delegated ER gameplay, session-key actions, real VRF callbacks, both success and failure settlements, and independent base-layer balance/receipt reads.

The current browser suite contains 23 passing tests (including in-browser recomputation of real devnet VRF rolls). The live verification command, `npm run verify:devnet-wager` from `app/`, refuses to transact if the deployed program bytes do not match the local binary. It also resumes an unresolved run and recognizes already-settled test evidence, rather than creating duplicate stakes after an interruption.

## Scope and honest limitations

V3 is a devnet prototype, not a gambling, payments, or custody product.

- Demo credits have no cash value, cannot be deposited, withdrawn, transferred, or redeemed.
- There is no mainnet launch, USDC/SOL staking, token payout, collectible minting, or profit guarantee.
- A delayed VRF request remains pending; the prototype intentionally provides no automatic outage refund or arbitrary reroll.
- The session key is temporary and memory-only. Reload can require a new wallet authorization to continue a live run.
- The live CLI verification is strong lifecycle evidence, but it does not replace fresh-wallet, manual browser validation or a production security audit.
- A real-money product would need a separate technical architecture, legal/compliance review, security audit, operational controls, and launch approval.

## Running it

```bash
cd app
npm ci
npm run dev
```

Open `http://localhost:3000`, choose **Risk gates**, then use **Local practice** for a wallet-free walkthrough or **Devnet wager** with a Solana devnet wallet. Copy `.env.example` to `app/.env.local`; it enables the devnet wager flag by default.

For implementation details, test commands, and the complete live evidence log, see [README.md](README.md) and [docs/wager-prototype.md](docs/wager-prototype.md).
