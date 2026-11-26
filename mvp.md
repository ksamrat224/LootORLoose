# Current MVP direction: stake once, hunt three

The current implementation uses one stake, three distinct quests chosen from six, independent random rewards and one final collection. New practice hunts use [V6 rewards](docs/HUNTS_V6.md), averaging 95.55% before rounding. Existing V5 hunts and deployed devnet retain [V5 rules](docs/HUNTS_V5.md) and their 86.5% average. The compatible V6 upgrade and automated live checks passed; V6 creation stays disabled in the normal app pending manual Phantom verification. Earlier versions below remain historical context.

---

Loot or Lose: the final MVP, end to end
This is what I'd ship by Nov 27. It is the current V3 plus the polish we've discussed. It doesn't change the deployed program. Items marked ✅ exist today, and items marked 🔜 are not built yet.

The pitch
"Walk a dungeon, choose a stake in demo credits, and decide at each guardian gate whether to extract your winnings or risk them for more. The game runs at game speed on a MagicBlock Ephemeral Rollup. Every roll is verifiable VRF, and every result is settled on Solana. You can check any roll yourself."

The player's journey
Landing page ✅. The player picks Risk gates and then either Local practice (no wallet, browser randomness) or Devnet wager.
Start screen ✅.
The player connects a devnet wallet. The first play grants $100 in demo credits, labelled DEMO CREDITS · NO CASH VALUE.
The odds ladder is public: 76% for 1.25×, 62.5% for 2×, 66⅔% for 3×. It is a 95% theoretical return.
The stake is $2, $5 or a custom amount from $1 to $100.
Start run ✅. One click does everything:
Create the wager on the base layer and reserve the 3× payout.
Delegate the wager state to the ER.
Authorize a 4-minute session key, so there are no per-move wallet popups.
Dungeon ✅. The player walks with WASD or the arrow keys on a Phaser tile map.
Every tile is validated by the program, and walking can't lose the stake.
The player can cancel for a full refund until the first gate is requested.
Risk a gate ✅. The player stands beside a guardian and presses E.
The VRF request goes out and the UI shows "Randomness pending". Movement, extraction and re-rolls are locked.
The VRF callback resolves the gate.
Proof of roll ✅ (built this session). A card shows the VRF bytes, the fulfilment time and a Verify in your browser button.
The decision ✅. After gates 1 and 2, Extract and Risk next gate sit side by side. Gate 3 pays 3× automatically. A failed gate pays $0.
Settlement ✅.
The terminal state commits and undelegates back to Solana.
A base-layer transaction credits the payout, releases the reserve and marks the receipt settled.
The UI says EXTRACTED, LOST or REFUNDED only after the base layer confirms.
Receipt ✅. A technical-details panel shows the run address, ER endpoint, nonces and explorer links.
What's in the stack
Layer	Feature	Status
ER	Low-latency movement, gate requests and extraction on a delegated WagerState	✅
VRF	Authenticated callback bound to the run, gate and request nonce, with unbiased sampling	✅
Session keys	Short-lived signer that has no ledger authority	✅
Base layer	Credit ledger with a house-solvency invariant, idempotent settlement, versioned PDAs	✅
Recovery	Signed-transaction identity is saved, reload recovery works, and the app never rerolls or auto-losses	✅
Verifiability	In-browser roll recomputation	✅
Brand	Torch Vault palette	✅
Tests	23 browser/unit tests, program tests, a live devnet verifier script	✅
What would make it feel like a finished product
Feature	Why it matters	Status
Risk ladder + run recap: live "extract $2.50 now vs. continue 62.5% × $4.00" panel, then a recap against optimal strategy	This is the "finance" in Entertainment Finance	🔜
Game feel: reveal animation, sound, loss shake, gold burst on extract	Judges remember the feel	🔜
Demo resilience: fall back to practice mode if the ER or VRF is slow, with a clear recovery timer	A failed live demo is the biggest way to lose	🔜
Onboarding: a guided first run with tooltips	Judges try it cold	🔜
Fresh-wallet run + backup demo video	Proves the end-to-end path and covers a live failure	🔜
Scope boundaries
The MVP deliberately has none of these, and the pitch should say so:

Real money, deposits, withdrawals or token payouts.
Mainnet.
Collectibles or NFTs.
An audit.
An automatic outage refund. A stalled VRF request stays pending and is never rerolled.
The pitch to judges should say this: the demo credits are fictional, but the mechanics (reserved liabilities, verifiable randomness, and a base-layer receipt you can check) are what a real entertainment-finance product would need.

My recommendation for the last two days
Run a fresh-wallet end-to-end pass (the only way to know the live path is solid).
Build the risk ladder and recap, since it ties the theme to the demo.
Do the game-feel pass.
Add the practice-mode fallback, and record a 2–3 minute backup video showing the explorer links and the Verify button.