# V6 devnet release and Phantom verification

Release work began Nov 26, 2026. All balances are fictional demo credits. V6 remains disabled in the normal app until automated checks and the required manual Phantom scenarios pass. The isolated release candidate uses the same source with V6 enabled.

## Preparation

- Owner practice feedback: “it look good to me.” This is qualitative pacing/UI feedback, not a measured win rate.
- Program build and 37 program tests passed. Legacy account layouts and existing instruction interfaces remain unchanged; generated/browser IDLs match.
- CLI payer and upgrade authority match: `FcrKifd5HL356zXZ8agnsMSyLdFZgox65Jxe4JTC3avr`.
- Program: `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj`; ProgramData: `JBLWaMkueDfekXzEh7ydTV3EsaBdwjgPFDR3phP1F8o8`.
- Deployed V5 baseline: slot 526434931, 867,160-byte ELF, SHA-256 `3a575566d71a83124cf8720863fbcb3f3d1fcd53f0bf356f51515db3f42b6dd7`. Public binary saved locally before the upgrade.
- Reservation baseline: 999 fictional cents, entirely the previously documented abandoned V5 hunt. No new expiry, refund or forfeiture policy is introduced.

## Live evidence

[Upgrade transaction](https://explorer.solana.com/tx/3XHi2xG4MC8AUurNenNkKvf5K62y3pJeM5uSd8TtUU89WKZZVkepmMeLmoSYePzuWX4LoXjWeXLGTAQNTuyqWSzD?cluster=devnet), slot **526500532**. ELF **872,200 bytes**, SHA-256 `fb18204fc73a99f6d69cde3d4640fe6e3b81e40dd7a68098d298ffeadef10cf1`. Both base ProgramData and router-selected Asia ER inline ELF match. Program capacity and rent are unchanged; deployment payer debit was **4,325,000 lamports (0.004325 devnet SOL)** across the upgrade.

[Public account snapshots and transaction evidence](devnet-v6-evidence.json) record the actual results. Automated live checks passed:

- Pre-upgrade V5 hunt `28JtYN5x9Lk1BovWWgEfuZmV41mheWuyg3Bt5thLk6Uq` resumed after the upgrade and settled for zero, balance 9,800 cents. Its original reveal bytes, bucket 10 and zero reward are unchanged; V6 would pay a different reward for that bucket.
- V6 session hunt `HXp8ErGa4Go3pPdo7HjuCCHEirJrPb2qADfjDDnpBn3H` settled for 180 cents, balance 9,980. An atomic request+revoke preserved the callback; the old key was rejected with program error 2003, and both base/ER token closure were observed. Subscription updates for pending nonce 2 and fulfilled nonce 3 arrived 14 ms apart; this is an observed update interval, not a provider latency guarantee.
- Fresh-wallet browser hunt `2oh13XFXtRsLHF71NqhuPk41h9iRiXGHt8uVamXMz9Si` returned 240 cents from three 80-cent reveals, balance 10,040. Separate V6 cancellation `6MjZrXTb2QhToZyNTL8aqcrVYhkBxZSKedsUWKjRMyAA` refunded 200 cents and retained that balance. All recorded proofs recompute using their stored versions.
- Browser preparation required one approval. The full session/reload/rejection/collection/cancellation stress run made 12 approval requests, including one deliberately rejected ER binding. Its funded key was reused on explicit retry.
- Real request and base-credit uploads completed while their HTTP responses were deliberately dropped; the same hunt recovered and settled. These were controlled client interruptions, not a provider outage.
- Actual duplicate base credit instructions for V5 and V6 were submitted with the configured payer sponsoring fees. Player balances, house balance and reserved total stayed unchanged. This is separate from the client's settled-ticket short circuit.
- Reservations reconcile to the baseline 999 fictional cents; every new release-test hunt is settled or cancelled. Remaining liquid authority-wallet funding was returned. Test session top-ups and account rent are recorded costs, not promised refunds.

The first V5 preparation stopped on an overly strict verifier assumption about the ER executable layout. That same hunt was resumed after fixing the verifier. Two early V6 session-check attempts stopped on transient RPC read failures before randomness; the same funded hunt was resumed and completed. These interrupted attempts are not counted as fresh complete passes. Release tools now make at most three logged attempts for transient unsigned account/blockhash reads; simulation, signing and transaction uploads are never automatically retried.

Local checks: 89 tests passed in the full frontend suite, plus three targeted release-verifier tests; 37 program tests passed. Lint and both normal/V6-candidate production builds passed. The normal app on port 3000 was read-only checked to advertise V5 devnet rules; the isolated production candidate on port 3240 advertises V6 and 95.55%.

Manual Phantom observations remain pending. A failed driver check never counts as a passing browser lifecycle even if cleanup settles its hunt.

## Manual Phantom — pending

Use a fresh devnet-only Phantom wallet. Record browser and Phantom versions, wallet public address, signatures and actual approval counts. Never share private keys or recovery phrases. V5 and V6 share one one-time hunt demo allocation.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Connect and inspect V6 rules/demo labels | Pending | |
| Reject first preparation; verify no stake/session; explicitly retry | Pending | |
| Prepare hunt; record approval count; open quest with session signing | Pending | |
| Reload, authorize same hunt and verify existing progress | Pending | |
| Let session expire; explicitly renew the same hunt | Pending | |
| End session; reject one revocation stage, recover/reload and finish it | Pending | |
| Finish three distinct reveals; collect once; verify base balance | Pending | |
| Cancel a separate unopened hunt and collect full refund | Pending | |
| Switch/disconnect wallet during approval; reconnect and recover | Pending | |
| Keyboard/Escape, mobile/landscape dialogs and result spacing | Pending | |
| Revoke during naturally observable pending randomness | Unobserved | Automated request+revoke checks are separate evidence. |

Normal-app V6 activation is pending the required manual scenarios. An unobservably fast callback is not a manual pending-revocation pass. An actual provider outage remains untested; dropping a real RPC response tests client interruption recovery only.

## Repeat commands

Run from `app/`, with `NEXT_PUBLIC_HUNT_V6_ENABLED=true` explicitly set for V6 Node checks and for the isolated app build:

```bash
NEXT_PUBLIC_HUNT_V6_ENABLED=true npm run verify:devnet-sessions -- --send --expect-rules=6
NEXT_PUBLIC_HUNT_V6_ENABLED=true LIVE_HUNT_URL=http://localhost:3240 npm run verify:devnet-hunts-browser -- --send --expect-rules=6 --interrupt --reject-binding
npm run verify:devnet-reservations
```

Live scripts require explicit expected rules and compare deployed binary bytes before new test funding. Session-check `--pause-after-first-reveal` deliberately retains its recoverable hunt for upgrade compatibility testing; resume using its same public `LIVE_SESSION_WALLET_TAG`. `LIVE_HUNT_BINARY` selects an explicitly captured baseline ELF for the pre-upgrade check only. Keys remain in memory; public tags support recovery without saving another private key.

If activation later needs to be stopped, disable new V6 creation but keep V5/V6-capable recovery code deployed. Never restore a V5-only binary while V6 hunts exist.
