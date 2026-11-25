# V5 devnet deployment and live verification

Verified Nov 25, 2026. V5 is enabled in the example and local app environments. Practice remains the initial mode. All game balances are fictional credits.

## Deployment

| Item | Value |
|---|---|
| Program | `BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj` |
| ProgramData | `JBLWaMkueDfekXzEh7ydTV3EsaBdwjgPFDR3phP1F8o8` |
| Upgrade authority | `FcrKifd5HL356zXZ8agnsMSyLdFZgox65Jxe4JTC3avr` |
| Deployment slot | 526210032 |
| ELF length | 866,280 bytes |
| ELF SHA-256 | `d1647cd4d8198ef180e529a1b5834815acb5333acbad1f634f6c52d32baf5600` |

[Upgrade transaction](https://explorer.solana.com/tx/AxkX4QNFN1RFrtvByrRSS72w7fU3AG6QB4P8Zun3z9qWbce9YVLFJnJnCyzWJCvCY46BXmhamVCQ1EQtH7io7my?cluster=devnet). Independently read ProgramData bytes match the local ELF. The upgrade kept the authority and legacy layouts. Program-account rent increased from 2.8013406 to 4.40158124 devnet SOL; fees were additional. The prior binary is retained in ignored local build artifacts.

Transactions used base `https://rpc.magicblock.app/devnet`, router `https://devnet-router.magicblock.app/`, and router-selected ER `https://devnet-as.magicblock.app/`. ER signatures may not appear in the base explorer.

## Passing live checks

- CLI hunt `5XHzf2A4WHkwcw8K1R2LreMSqRufSmAFsXQ2i7KxpKKE` opened quests 0, 1 and 2. Actual VRF rewards were 0, 0 and 50 cents from a 200-cent stake. [Settlement](https://explorer.solana.com/tx/7TvVnJVnn5KpQe5bC5tMXW5EN8wxNqeUdZGryLWBTg79k5A9pvnF2s9toxtmtLQS6ccfh6kaUE9nCwRPmwmmfKv?cluster=devnet) left 9,850 cents and no active CLI hunt.
- A second actual settlement instruction left the same 9,850-cent balance unchanged. [Duplicate settlement receipt](https://explorer.solana.com/tx/GzPTpXd6xmJLvHhW8cDsHunXyCo8YEZr5xdtAgYku1wmJWHASwvnTANW9GuB96yV5wvJzV4G2USm4bRPafeQp3E?cluster=devnet).
- Fresh browser wallet `4BNXPgS9kAdszvRSrLefwo4bRVHr1iLzaXpJtBVHVinB` completed hunt `hz76BzjPorhQMo5ptMvs3savq3j9nv36mmK6DZsZTQ9`. Quests 5, 3 and 4 returned 200, 100 and 0 cents. [Collection](https://explorer.solana.com/tx/2yFtNQDunc93qrzNdov1fsaJEYnjehCwoE9QeVcCrPRpfNDfLG7QCXJymS6F4ziWn5jxg4evkLTyuuNDB2mcF6FC?cluster=devnet) confirmed a 300-cent return and 10,100-cent balance.
- After the first reveal, the browser reloaded, reconnected and authorized a new session. It retained the same hunt, stake and loot before completing the remaining reveals. The proof dialog recomputed all samples, rewards, mask and sum and displayed Match.
- The same wallet cancelled hunt `C3A646PvoEqHvhscvx5UN8z4vkEemQkJViqG99sRCf9c` before randomness. Its [full refund](https://explorer.solana.com/tx/4TkbwnhYPBFjh6qRoo94HurT2rrCQHeJb8yTwAfJC5eyv7pz7MjyCd8XBozodXDX9pUUFqWeeg9GR4fp4BCccDX5?cluster=devnet) restored 10,100 cents; no active hunt remained.
- Earlier browser hunt `B5YxzgjrXtwaQ9Q3UY29zUJyionwWiTRDffcH9ubje9Q` includes bucket 99, paying floor(200 × 5/3) = 333 cents. Its combined 383-cent return settled correctly.

This browser check used an automated Wallet Standard signer, real RPC and actual transactions, without RPC interception. The fresh wallet received 0.05 devnet SOL, and remaining liquid SOL was returned afterward. The hunt, reload and separate cancellation required 16 wallet signatures. Manual Phantom/other extension approval UX and an actual service-outage exercise remain separate checks.

## Recovery observations and excluded attempts

An earlier refund upload had no confirmed signature. Its driver timed out and was **not** counted as a complete browser pass. Recovery settled the existing cancelled hunt `4W1TUfVST6ZF5NC8cE4i9RvCu942hQs2DDm4KB6QAVwn`, restoring 10,183 cents without another stake or randomness request. A later complete browser run passed collection and refund directly. The [MagicBlock status API](https://status.magicblock.app/api/services) reported devnet services operational when checked; the dropped upload does not establish a general outage.

Initial driver failures included a serialized-helper error before wallet connection and a five-second assertion that was too short for live session preparation. Those attempts are excluded from passing evidence. One earlier disposable-wallet hunt, `GhyF4NgfWrXkxLGGNm2nk1pxghXzysLBor1siApTVEXV`, remains active after its driver exited and lost its temporary signer. It holds 999 fictional cents of reservation and is not marked settled or passed. The captured house balance is 1,000,067 cents with 999 reserved, so it remains solvent. Later driver versions recover failures before exiting and derive temporary signers from a recorded public tag and the configured CLI key, without saving another keypair file.

The [account snapshot](devnet-v5-evidence.json) includes successful and excluded accounts, actual randomness bytes, buckets, rewards and settlement flags. The verifier waits for the expected reveal count rather than accepting a stale Active read. The UI retains a confirmed request's nonce and pending phase until newer authoritative state arrives.

## Repeat checks

- `npm run verify:devnet-hunts` compares deployed and local bytes without sending.
- `npm run verify:devnet-hunts -- --send --quests=0,1,2` runs bounded normal demo hunts and verifies settlement.
- Start the local app on port 3230 with V5 enabled, then run `npm run verify:devnet-hunts-browser -- --send`. `LIVE_HUNT_URL` can select another localhost port.
- Keep the deployed binary and browser IDL matched. Program changes require another byte comparison and appropriate live checks.
