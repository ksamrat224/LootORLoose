# V5 preparation, subscriptions and session verification

> This records the deployed V5 release. The subsequent [V6 upgrade and live verification](DEVNET_V6_VERIFICATION.md) supersedes the binary hash below; normal V6 activation remains gated on manual Phantom checks.

Verified November 26, 2026, on devnet. All game balances are fictional demo credits. This supplements the [initial V5 verification](DEVNET_V5_VERIFICATION.md).

## Deployment

The program remains `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj`, with ProgramData `JBLWaMkueDfekXzEh7ydTV3EsaBdwjgPFDR3phP1F8o8` and unchanged upgrade authority. The upgrade adds wallet-only `revoke_hunt_session(index)` without changing existing account layouts, seeds, rewards or legacy handlers.

[Upgrade transaction](https://explorer.solana.com/tx/4tER2STqggnR2u3JrKxNjnkGh1MTQ3cQfufMwbvjoFmbhWyjFLJP4bKLC42k7RP8jSSmRdnQJQsVGeEbXRBVSVrQ?cluster=devnet), slot **526434931**. ELF length **867,160 bytes**; SHA-256 `3a575566d71a83124cf8720863fbcb3f3d1fcd53f0bf356f51515db3f42b6dd7`. Base and selected ER ProgramData bytes were checked. The initial automatic extension was rejected in simulation because this cluster requires a minimum 10,240-byte extension. An explicit extension succeeded; ProgramData capacity is 876,520 bytes and rent is 4.45360044 devnet SOL.

`NEXT_PUBLIC_HUNT_SESSION_CONTROL_ENABLED` gates the new controls independently of V5 play. Enable it only for the verified upgraded binary; restart the app after changing public flags.

## Automated live evidence

- A fresh wallet completed ledger initialization, stake reservation, session creation, hunt authorization and delegation with **one wallet approval**. Offline packet measurements were 764 bytes normally and 778 with player initialization, before the compute-budget instruction. Simulation precedes signing; resource-limit fallback uses two numbered approvals.
- Session-check wallet `2qqxV6iVaeng6uprHToHs667sb9RB3fgJNb77UK2KHvS` completed hunt `EUcGEfCN5vTqD9MXmeuW6HT2rWouAQohFkbUPuqxGRLt`. A single ER transaction requested randomness and immediately removed session permission while that request was pending. The still-valid old key was rejected by program constraints before its base token was closed. The accepted callback still completed, both runtimes observed token closure, all three reveals verified, and settlement returned 200 cents from a 200-cent stake, leaving 10,000 cents.
- Fresh browser wallet `Dh5qBQp6Sq6uizcLP2HVu1oPcV19wi5DjgRu4Ln3KUWV` completed hunt `9DFUaJaL4gm29DaamftC6bw7vDrGn8btB32q1UNukPEC`. Preparation required one approval. Actual reveals returned 200, 0 and 100 cents. Collection confirmed 10,100 cents; a separate pre-request cancellation restored that same balance. The broader lifecycle required **11 approvals**, including session ending, reload authorization, collection and refund; this is not a promise about extension popup presentation.
- A subsequent browser repeat on the final recovery flow used wallet `GGiiw3xkJv9sHW8G3yb5CXcgKu9mkHUYnLAgR54g2NCy`, hunt `AXf5Yuzzy9iEsrzFQSSCK5RXxUQL5mXkZ4EaMEGzsgK5`. Rewards were 0, 0 and 50 cents; collection and a separate refund left 9,850 cents. Both controlled response drops passed again, with 11 approvals.
- A controlled authorization rejection on wallet `64WnX78cHtXc9yofeWgiZMjduMpcvT5TwtvPgrPR2yjg` verified that renewal reused its funded in-memory key. Retrying required one ER approval, with no second session-creation transaction. Hunt `G4vgNkq8b3vrmxkFT5oNgF7P6kB52dwEP4g1bgbjCJKc` naturally revealed three zeros, settled to 9,800 cents, and a separate cancellation refunded correctly. The scenario used 12 approval requests, including one deliberately rejected request; both connection interruptions also passed.
- The browser received ER subscription events for request, reveal and session-block nonces. The session checker observed pending nonce 2 and callback nonce 3 only milliseconds apart, before the five-second watchdog. Polling remains available when notifications are unavailable.
- With `--interrupt`, the browser driver forwarded actual request and settlement uploads to devnet, then discarded their HTTP responses. Recovery reconciled the original signed transactions; the same three reveals and exactly one settlement remained. These are **controlled client connection failures**, not a simulated or actual MagicBlock provider outage. No reward response was fabricated.
- Browser session controls removed hunt authorization and closed the token. Reload recovered the same hunt and permitted explicit reauthorization. Automated fixtures separately cover reload between the two revocation stages, unavailable subscriptions, stale endpoint events and the four target viewport sizes.

[Public account snapshot and receipts](devnet-session-evidence.json) record the on-chain results. Test keys remain in memory. The verifiers log a public recovery tag; the configured CLI signer can derive the same disposable wallet if a check exits early. Remaining liquid test SOL is returned after completed checks.

## Excluded checks and limitations

An early session check reached the ER before the upgraded program was available there and received Anchor error 101 in simulation. No randomness transaction from that failed simulation was uploaded. Its original hunt was recovered and settled rather than replaced; a later fresh check passed the full revocation sequence. Another browser driver completed three all-zero reveals and settlement but initially failed to reopen the settled result after recovery; it is excluded from complete passing browser evidence. The recovery result handling was corrected and the later browser lifecycle passed.

The historical abandoned wallet `7xHAmeQB1wBS7yyLQa8d8bHKZJfvmyDFV52AmXZ6ih3z` still has one revealed quest and **999 fictional cents reserved**. Lost wallet authority cannot be replaced with a session key. The report reconciles unsettled ticket reservations against the house. There is no expiry, administrative refund, forfeiture or pending-request reroll.

Manual extension approval UX and an actual provider-outage exercise remain unverified. The automated Wallet Standard signer submits real transactions but cannot establish what a Phantom popup looks like.

## Local verification

The final frontend/browser suite passed **80 tests**, including all four viewport sizes, session funding recovery and rejected authorization. Program tests passed **32 tests**, including pending-request revocation, callback identity preservation and atomic rollback. Frontend lint and the production build passed. The generated IDL matches the browser IDL; all previous account layouts are unchanged.

## Repeat checks

From `app/`:

```bash
npm run verify:devnet-hunts                         # read-only deployed ELF comparison
npm run verify:devnet-reservations                  # read-only reservation reconciliation
npm run verify:devnet-sessions -- --send --expect-rules=5             # bounded session lifecycle; 0.03 devnet SOL funding
npm run verify:devnet-hunts-browser -- --send --expect-rules=5 --interrupt --reject-binding
```

The browser checker requires a localhost app with both V5 and session controls enabled (default port 3230). It funds a fresh wallet with 0.05 devnet SOL. Every accepted pending request remains bound to its hunt and is observed rather than rerolled. Failed checks are not reported as passes.

## Manual Phantom checklist — pending

Use a fresh test wallet on **devnet**, funded with devnet SOL. Record browser/Phantom versions, wallet public key, signatures and observed approval counts. Never record recovery phrases or private keys.

- [ ] Connect on welcome/setup. Verify demo-credit labels and the separate V5 allocation.
- [ ] Reject the first preparation approval. Verify no stake, funded session or new hunt exists. Retry explicitly; inspect the combined stake/session/delegation transaction and confirm preparation normally uses one approval.
- [ ] Open a quest. Confirm it uses the authorized session without another wallet approval. Check the reveal and its proof.
- [ ] Open Session and end gameplay. Inspect the separate ER block and base token-closure approvals. Reject either stage once, recover, reload and finish ending that same session.
- [ ] End the session while a randomness request is pending. Verify its reveal still arrives and previous loot remains unchanged. Confirm another quest requires explicit authorization.
- [ ] Reload and authorize the same hunt. Check two approvals: base session creation and ER hunt authorization. Let a session expire and verify the same explicit renewal flow.
- [ ] Complete three reveals and collect. Inspect commit/undelegation and Solana credit approvals; compare the confirmed balance with the base receipt. Reopen the receipt without another credit.
- [ ] Cancel a separate hunt before randomness and verify a full refund. Verify cancellation is unavailable after the first request.
- [ ] Disconnect or switch wallets during approval. Confirm the old context cannot upload afterward and reconnecting recovers its original hunt.
- [ ] Check Session, rules, proof and result dialogs with keyboard navigation and Escape, plus 375×667 and landscape touch layouts.

Until this checklist is completed, mark manual Phantom verification **pending** in release notes.
