> Current gameplay is V5: stake once, hunt three different quests from six, and collect their combined random loot. See [HUNTS_V5.md](HUNTS_V5.md). V5 devnet remains disabled pending live verification. V3/V4 recovery is preserved.

# Loot or Lose — Roadmap, issues and fixes

_Written Nov 25, 2026. Demo target: **Nov 27, 2026**. Audience: the team. Read with [mvp.md](../mvp.md) (what the finished MVP is) and [UI_DIRECTION.md](UI_DIRECTION.md) (what the UI should become)._

## Where we are

- V5 three-reveal hunts and the fixed-screen UI are implemented locally; see [HUNTS_V5.md](HUNTS_V5.md). V5 devnet stays disabled pending matching deployment, real VRF reveals, settlement and a fresh-wallet browser check. The tasks below originated for V3 and do not verify V5.

Historical V3 implementation notes:

- V3 (demo-credit risk gates) is deployed on devnet and verified live with real VRF callbacks. See [wager-prototype.md](wager-prototype.md).
- The proof-of-roll card, which recomputes VRF outcomes in the browser, is committed (`5540474`). Lint, build and 23 browser/unit tests pass.
- Torch Vault palette is applied to the CSS tokens.
- Practice fallback is available for delayed VRF and recovery errors; a mocked-RPC test covers switching back to the pending devnet run. Live outage verification remains open.
- A gate progress track and expected-value decision line are in place; the sprite board and run recap remain open.
- The weakest part of the product is the **look and feel**, not the chain logic. The game board is drawn from rectangles and circles with no sprites, lighting or sound.

Priority key: **P0** must be done before the demo, **P1** makes the MVP more winnable, **P2** after the hackathon.

---

## 1. Things to do

### P0 — before the demo

| #   | Task                                                                                                                                                 | Why                                                                                          | Done when                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | **Fresh-wallet end-to-end run in a real browser.** New wallet, devnet airdrop, start, play, extract. Then a second run to a loss.                    | The docs list this as an open release gate. Everything so far is fixtures plus a CLI script. | Both outcomes settle; displayed balances equal base-layer reads; no console errors.                |
| 2   | **UI overhaul, first pass** (see [UI_DIRECTION.md](UI_DIRECTION.md) §C steps 1–5): tokens, sprite board, gate states, progress track.                | Judges decide in the first 30 seconds. The current board looks like a prototype.             | Screenshots at 375/768/1280 look intentional; reference-image checklist in UI_DIRECTION §D passes. |
| 3   | **Practice-mode fallback.** If the ER or VRF is slow, offer "Switch to practice" without losing the wager. Keep the 60-second delayed-service state. | A stalled live demo is the most likely way to lose.                                          | With the ER blocked, the UI explains the delay and offers a working path in under one click.       |
| 4   | **Backup demo video (2–3 min).** Show the explorer links, the ER endpoint, the VRF bytes and the Verify button.                                      | Insurance against live failure; also the submission asset.                                   | A recorded run exists with a visible base-layer settlement.                                        |
| 5   | **Done: hide V1/V2 entries from the landing UI** (free local demo, free devnet run).                                                                       | They show a different, weaker game and split the story. The code stays.                      | Landing offers only Risk gates (practice / devnet).                                                |

### P1 — makes the MVP more winnable

| #   | Task                                                                                                                                                                                                        | Why                                                    | Done when                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 6   | **Risk ladder + run recap.** Live line "extract $2.50 now vs. continue 62.5% × $4.00", then a post-run recap against the optimal strategy. Reuse `GATES` and `gateReturn` in `app/src/game/wager-rules.ts`. | This is the "finance" in Entertainment Finance.        | Every decision shows EV; the recap states the player's result vs the 95% RTP baseline.    |
| 7   | **Game feel.** Reveal beat (≥1.5 s even if VRF is faster), coin burst on extract, loss shake, sound with a mute toggle.                                                                                     | Feel is what judges remember.                          | Each outcome has a distinct visual and audio beat; `prefers-reduced-motion` is respected. |
| 8   | **Result screen** modelled on reference 3 (banner, progress track, haul summary).                                                                                                                           | The end of the run is the payoff and the proof moment. | EXTRACTED / LOST / REFUNDED banner appears only after base-layer confirmation.            |
| 9   | **Onboarding.** A 20-second guided first run.                                                                                                                                                               | Judges try it cold.                                    | A new visitor reaches their first gate request without reading the rules card.            |
| 10  | **Visual regression tests.** Playwright `toHaveScreenshot` for start, dungeon and result at three widths.                                                                                                   | The suite currently proves behaviour, not appearance.  | Screenshots are committed and the suite fails on unintended visual change.                |

### P2 — after the hackathon

- Remove or split V1/V2 code (`lib.rs`, `OnchainGame.tsx`, parts of `chain.ts`).
- Investigate pending-gate outage recovery. A timeout or cancellation design requires fairness and security review, protection against selectively discarding an unfavourable outcome, a program upgrade and full re-verification.
- Independent security review (`/cso`) before any wider release.
- Any real-money or custody idea requires a separate architecture, legal/compliance review and audit. It is not a continuation of this prototype.

---

## 2. Known issues and the fix for each

| Issue                                                                                                                                                               | Severity                 | Evidence                                                                               | Fix                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Board is built from primitives.** Rectangles, circles and text glyphs ("↗", "✦") on a fixed 608×380 canvas (16×10 tiles × 38 px). `assets/` is empty.             | High (visual)            | `app/src/game/PhaserBoard.tsx`, `app/src/game/model.ts`                                | Sprite tileset, scale-to-fit, lighting. See UI_DIRECTION §B.                                                                                                                                     |
| **Board resolution is limited on desktop.** The fixed 608×380 logical canvas already uses `Scale.FIT`.                                                                                                            | Medium                   | `PhaserBoard.tsx` config `width: 608, height: 380`                                     | Review rendered size and sharpness; increase logical tile resolution if needed while retaining `Scale.FIT`.                                                                                                                                             |
| **Earlier roll proofs depend on browser storage.** The program overwrites `wager.randomness` at each gate; a different browser or cleared storage can recover only the latest roll from the account. | Low                      | `app/src/game/RollProof.tsx`; `wager::resolve` in `programs/loot_or_lose/src/wager.rs` | Already persisted in `localStorage` per wager. UI says where the bytes come from. Optional later: index the callback transactions for the account.                                               |
| **No link to the VRF callback transaction.** The client never sees the callback's signature.                                                                        | Low                      | Same                                                                                   | Link to the wager account (done). Optional later: look up recent ER signatures for the account.                                                                                                  |
| **A VRF stall locks the wager indefinitely.** By design, no auto-loss, refund or reroll.                                                                            | Medium (demo risk)       | `docs/wager-prototype.md` "Randomness and recovery"                                    | Before demo: practice fallback (task 3) and backup video. After: research a fair and secure recovery design (P2). Do **not** change the program before the demo.                                              |
| **Legacy V1/V2 code is tangled with V3.** V3 also reuses the V1 map.                                                                                                | Medium (maintainability) | `programs/loot_or_lose/src/lib.rs` (~440 lines), `OnchainGame.tsx`, `chain.ts`         | Hide entries now (task 5); remove after the demo.                                                                                                                                                |
| **CSS debt.** `globals.css` stacks several `:root` blocks and duplicate `.card` rules; Torch Vault was applied by editing literals (`#d9a452`) in multiple places.  | Medium                   | `app/src/app/globals.css`                                                              | Consolidate into one token block; replace literals with `var(--…)`.                                                                                                                              |
| **Palette and proof card verified by tests, not by eye.**                                                                                                           | Medium                   | Session notes                                                                          | Screenshot review at 375/768/1280 as part of task 2.                                                                                                                                             |
| **No visual regression tests.**                                                                                                                                     | Medium                   | `app/tests/`                                                                           | Task 10.                                                                                                                                                                                         |
| **Casino-like framing.** Stake, house, odds and payout ladder read as a wagering loop even with demo credits.                                                       | Medium (pitch)           | `about.md`                                                                             | Keep `DEMO CREDITS · NO CASH VALUE` visible on every screen with a balance. Lead the pitch with ER + VRF + verifiable settlement, not "wager".                                                   |
| **Reference art cannot be copied.** The four images in `pictures/` are screenshots from commercial games.                                                           | High (legal)             | `pictures/`                                                                            | Use them only as direction. Source CC0/permissively licensed tiles and sprites (for example Kenney or 0x72 packs) or draw original art. Record every source and licence in `assets/LICENSES.md`. |
| **Untracked working files.** `pictures/` and `mvp.md` are not committed.                                                                                            | Low                      | `git status`                                                                           | Commit `mvp.md`. Decide whether `pictures/` belongs in the repo; if so, note in the README that they are private references, not shipped assets.                                                 |

---

## 3. Fixes that are already done

- Stale docs archived and the documentation map added (README).
- Dead stub files removed from the program; `cargo check` passes.
- `.env.example` enables the V3 flag by default.
- `verify-roll.ts` type error fixed and committed; production build passes.
- Proof-of-roll card and tests added, including real devnet randomness vectors.
- Torch Vault palette applied to CSS tokens and the Phaser background colour.

---

## 4. Suggested schedule (2 days)

**Day 1 (Nov 25–26)**

1. Fresh-wallet run (task 1), and fix whatever it finds.
2. UI first pass: tokens, sprite board, gate states, progress track (task 2).
3. Hide V1/V2 entries (task 5) — done.

**Day 2 (Nov 26–27)**

4. Practice fallback (task 3).
5. Result screen and risk ladder (tasks 8, 6) if time allows.
6. Final fresh-wallet pass, record the backup video (task 4), freeze the build.

**Rule for the last six hours:** no program changes, no new dependencies, only fixes found by the final pass.

## 5. Release checklist

- [ ] `npm run lint`, `npm run build`, `npm test` pass from a clean checkout.
- [ ] `NO_DNA=1 cargo test -p loot_or_lose --tests` passes.
- [ ] `npm run verify:devnet-wager` confirms the deployed ELF still matches the local one.
- [ ] Fresh-wallet win and loss both settle on devnet.
- [ ] Every screen with a balance shows `DEMO CREDITS · NO CASH VALUE`.
- [ ] No claim of real money, mainnet, audit or guaranteed returns anywhere in the UI or the pitch.
- [ ] `assets/LICENSES.md` lists every third-party asset.
- [ ] Backup video recorded and stored outside the repo.
