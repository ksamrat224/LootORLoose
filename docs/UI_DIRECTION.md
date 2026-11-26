> Hunt polish update (Nov 26, 2026): keep every quest marker, wall and path visible. Dim only unexplored floor detail; reveal within two Manhattan steps. Journal lore unlocks from confirmed reveals, including zero; North/South/Across route badges unlock after confirmed collection. These are browser-local cosmetic features with separate practice and devnet-wallet progress. Contextual guidance is dismissible and replayable from Journal. Do not change payouts, approvals or legacy recovery to support these features.

> Current gameplay: new practice hunts use [V6 rewards](HUNTS_V6.md), averaging 95.55% before rounding. Existing V5 hunts and deployed devnet retain [V5 rules](HUNTS_V5.md). The compatible V6 upgrade and automated live checks passed; V6 creation stays disabled in the normal app pending manual Phantom verification. V3/V4 recovery is preserved.

# Loot or Lose — UI direction

> V5 update: use the supplied brand-logo and pixel-hero from `app/public/brand/` and retain the fixed `100dvh` layout. The current flow is stake once → explore → three distinct quest reveals → collect. Keep unrevealed prizes out of the HUD and confirmations; the complete distribution belongs in Reward rules. The sequential gate track and long document layouts below are historical V3 guidance. Secondary information uses internally scrollable dialogs.

_Written Nov 25, 2026. Audience: whoever builds the UI (code or art). Companion to [ROADMAP.md](ROADMAP.md)._

## Why this document exists

The game logic is solid, but the screen does not sell it. Today the board is a 608×380 canvas drawn from rectangles, circles and text glyphs ("↗" for the exit, "✦" for the enemy). There are no sprites, no lighting, no particles, no sound and no reveal animation. The sidebar is a stack of text-heavy cards. Next to the four reference screenshots in `pictures/`, the app reads as a prototype.

The goal is **not** to copy those games. It is to take the _principles_ that make them feel finished and apply them to our one-room, three-gate loop.

> **Licensing rule:** the reference images are screenshots of commercial games. Use them only as direction. Do not trace, crop or reuse their art. Use CC0/permissively licensed assets (for example Kenney or 0x72 packs) or original pixel art, and record every source in `assets/LICENSES.md`.

---

## A. What each reference teaches

### 1. `pictures/1.jpeg` — dark stone dungeon, torch light, one gold focal point

**What it shows.** A top-down pixel-art dungeon at 1920×1080.

- Rooms float in near-black void. There is no visible edge to the world, only fog.
- Walls are raised and beveled. The top edge has a light grey highlight, so every wall has depth.
- Warm yellow torch glows sit at wall corners and throw soft pools of light onto the floor.
- Floor is dark brick, desaturated, with subtle cracks and dust.
- A **single saturated gold chest** is the only bright object in the room. The eye goes straight to it.
- Enemies are cream/bone-coloured skeletons with scattered bones on the floor. Trap tiles use octagonal rings; a floor grate marks a drop.
- The player is a small red-armoured figure, readable against the grey.

**Lesson for us.** Keep the world dark and desaturated so that **gold means value**. Light the scene locally (torches, a glow at each gate) instead of lighting everything. Fade the edges into void.

### 2. `pictures/2.jpeg` — the reward moment

**What it shows.** A hand-painted, cartoonish room right after a chest opens.

- The chest lid is open. Piles of gold coins, gems, a crystal and weapons are scattered around it.
- Each item has a **vertical beam of light** rising from it. Colour tints the glow by rarity (gold, green, blue).
- Glowing barrels and blue floor tiles show interactables and puzzle state.
- Dark vignette at the left and bottom; the loot area is the brightest region.

**Lesson for us.** The reward needs a _moment_. When a gate clears, show a burst of coins and a beam of light. When the player extracts, show the haul landing. Tier the glow by gate (copper, emerald, crown).

### 3. `pictures/3.jpeg` — the end-of-run screen

**What it shows.** A result screen over a dimmed scene.

- A banner at the top states the outcome in plain words ("ESCAPED WITH PENDANT").
- Under it, a **progress track**: connected circular nodes, three filled green, one active, and a skull at the end.
- A parchment-style panel holds a grid of item slots with counts. Rows separate "what you carried" from "what you stored".
- Counters at the right edge (chests ×5, skulls ×51) summarise totals.
- A button prompt at the bottom ("Go to Town") is the single next action.

**Lesson for us.** Our run is literally a track of three gates plus a loss. Use the same device: three nodes and a skull that fill in as the player progresses, and reuse it on the result screen. One banner, one summary, one next action.

### 4. `pictures/4.jpeg` — clean, readable room with doors and locks

**What it shows.** A tidy Zelda-like room at 1120×672.

- Torch-lit stone walls with decorative blocks and a barred cell window.
- A **wooden door with a padlock** in the top wall, and padlocked side doors.
- Open and closed chests, floating gold and silver **keys**, a gold coin, floor spikes.
- A mottled path on a blue-purple floor. Enemies (rats, a fire salamander, a spear guard) are clearly separate from the background.

**Lesson for us.** A gate is a **locked door**. Padlock = not yet risked. Opening it = the roll. This is a metaphor players already understand, and it makes each gate a distinct, legible landmark. Everything on screen is readable at a glance because shapes and colours are consistent.

### Summary of borrowed principles

| Principle                                | Source | Applied to                        |
| ---------------------------------------- | ------ | --------------------------------- |
| Dark, desaturated world; gold = value    | 1      | Palette, gate and chest emphasis  |
| Local light pools and vignette           | 1      | Torches, gate glow, void at edges |
| Reward burst with beams, tiered glow     | 2      | Gate-clear and extract moments    |
| Progress track ending in a skull         | 3      | HUD and result screen             |
| Banner + summary + single next action    | 3      | Result screen                     |
| Door and lock as the gate metaphor       | 4      | Gate sprites and states           |
| Strong readability and consistent shapes | 4      | Tileset and sprite choices        |

---

## B. Target UI

### B1. Visual language

- **Palette: Torch Vault.** Background `#110F0A`, surface `#1A1711`, line `#3A3326`, text `#F3F1ED`, amber `#D9A452`, amber light `#E8C389`. Tokens live in `app/src/app/globals.css` (consolidate them into one `:root`).
- **Colour roles.** Amber is for **value and decisions** (stake, return, Risk button). Mint/teal is only for **verified or settled** states. Red is only for **loss or danger**. Nothing else gets a saturated colour.
- **Gate accents.** Copper `#E8C389`, emerald `#83D7C5`, crown `#BAB0ED`, as in `GATES` (`app/src/game/wager-rules.ts`).
- **Type.** Keep Geist for UI. Use a pixel or slab display face for banners and the wordmark only. Monospace for hashes and VRF bytes.
- **Mood.** Torch-lit stone, warm, slightly dangerous, never neon. Demo-credit labelling stays visible but quiet.

### B2. The game board

Replace the primitive drawing in `PhaserBoard.tsx` with a sprite-based scene.

- **Tileset.** Dark brick floor with two or three variants and subtle cracks. Beveled walls with a light top edge. Corner pieces so walls look continuous.
- **Scale.** Use Phaser `Scale.FIT`. Target tiles of at least 48 px so the room fills most of the viewport on desktop. Keep the 16×10 logic grid and the program-validated map unchanged; this is purely presentation.
- **Lighting.** Torch sprites on walls with a two-frame flicker and a soft radial light overlay. A darkening vignette over the whole canvas. The outside of the room is void, not a flat border.
- **Player.** A small sprite with four-direction idle and walk frames. Keep the existing lerp so movement feels smooth between confirmed tiles.
- **Props.** A few barrels or pots and a bone scatter for life. Keep them off walkable tiles that matter, and never let decoration imply an interaction that does not exist.
- **Focal point.** The next gate is the brightest thing in the room. Earlier gates dim once cleared.

### B3. Gates as locked doors

Each gate is a door in the room with a padlock and a coloured frame. States:

| State       | When                                 | Look                                                                   |
| ----------- | ------------------------------------ | ---------------------------------------------------------------------- |
| **Locked**  | Not the next gate, or far away       | Dim frame, closed padlock                                              |
| **Ready**   | Next gate and the player is adjacent | Frame glows, padlock gently pulses, prompt "E · Risk"                  |
| **Rolling** | VRF request pending                  | Padlock shakes slowly, light charges. No other gate or action responds |
| **Cleared** | Gate succeeded                       | Padlock breaks, door opens, vertical beam of light, coin burst         |
| **Failed**  | Gate failed                          | Door slams, red flash, short screen shake, board dims                  |

Current gate positions are in `GATES`: gate 1 at (4,2), gate 2 at (8,7), gate 3 at (12,2). Place the door sprites at those tiles' wall or alcove positions, or redesign the map so each gate sits on a wall. Any map change must keep `isWalkable` and the program's `MAP` identical, or be made in both places and re-verified.

### B4. The reveal sequence

Randomness arrives whenever the VRF callback lands, which can be near-instant. The UI should still create a beat.

1. **Charge (0–0.6 s).** Padlock shakes, torches flare, a low rising sound.
2. **Hold (until the result is confirmed, minimum about 1.5 s total).**
3. **Outcome.**
   - Success: padlock breaks, door opens, a beam of light, a coin burst sized to the gate, a bright chime. The multiplier ("1.25×") floats up.
   - Failure: door slams, red flash, shake, a dull thud. The return counter drops to $0.00.
4. **Proof card slides in** with the VRF bytes and the Verify button.

Rules: no animation may imply an outcome before the confirmed state arrives. Respect `prefers-reduced-motion` by replacing shake and bursts with a fade. Sound is off until the player enables it; provide a visible mute toggle.

### B5. Layout and HUD

Desktop (1280):

```text
┌───────────────────────────────────────────────────────────────┐
│ LOOT OR LOSE      DEMO CREDITS · NO CASH VALUE   [wallet]     │
├───────────────────────────────────────────────────────────────┤
│  ● ───── ● ───── ○ ───── ☠        Stake $5.00 · Balance $93  │
│       (progress track)             Current return $6.25       │
├──────────────────────────────────────────┬────────────────────┤
│                                          │  YOUR CALL         │
│                                          │  The Emerald Maw   │
│            DUNGEON BOARD                 │  62.5% → 2×        │
│        (scale-to-fit, torch-lit)         │  Extract now $6.25 │
│                                          │  vs continue:      │
│                                          │  62.5% × $10.00    │
│                                          │  [Extract] [Risk]  │
│                                          ├────────────────────┤
│   WASD move · E risk gate                │  PROOF OF ROLL     │
│                                          │  (after each gate) │
└──────────────────────────────────────────┴────────────────────┘
        ▸ Technical details
```

- **Top bar.** Wordmark, the persistent `DEMO CREDITS · NO CASH VALUE` label, wallet button. Nothing else.
- **Progress track.** Three nodes and a skull (reference 3). Nodes fill as gates clear; the skull lights if a gate fails. It replaces most of the explanatory prose.
- **Stats strip.** Stake, balance, current return, net if extracted. One line, large numerals.
- **Right column.** Only the decision and the proof. Everything diagnostic stays behind **Technical details**.
- **Board.** The largest element, centred, with the controls hint under it.

Tablet (768): the right column moves under the board. Mobile (375): board on top at full width, a sticky decision bar at the bottom with the two buttons, proof and details collapsed under it. Every action stays reachable by button, not only by key.

### B6. Decision card (the "finance" moment)

- Title: the next guardian's name.
- One line of odds and return: "62.5% to reach 2×".
- **Expected-value line.** "Extract now: $6.25. Continue: 62.5% × $10.00 = $6.25 expected." Values come from `GATES` and `gateReturn` so the UI cannot drift from the rules.
- Two large buttons, side by side: **Extract $X** (outline amber) and **Risk gate N** (filled amber). Never hide Extract once available.
- A quiet text button for **Cancel · return full stake** only before the first gate request.
- Copy rule: never say "bet", "win cash" or imply money. Say "demo credits", "return", "extract".

### B7. Proof card

Keep the behaviour (shows the VRF bytes, fulfilment time, and a **Verify this roll in your browser** button). Restyle:

- Parchment-like ledger look (warm surface, thin line borders), monospace bytes, truncated with copy.
- On verify: mint check mark and "sample 7 of 25 < 19 → cleared". On mismatch: red cross and a plain explanation.
- One card per roll, newest at the top, collapsible.
- Footnote stays honest: bytes come from the wager account; we link to the account, not to a callback transaction.

### B8. Result screen

Based on reference 3. Appears over the dimmed board.

1. **Banner** — `EXTRACTED`, `LOST` or `REFUNDED`. Shown only after the base-layer ticket confirms. While the terminal state is frozen but not settled, the banner reads "Return frozen · settle to credit".
2. **Progress track** — final state of the three nodes and skull.
3. **Haul summary** — stake, total return, net, new balance.
4. **Recap** — each decision taken, and how it compares with the best fixed strategy (all strategies have a 95% theoretical return; say so plainly). No shame copy on a loss.
5. **Receipts** — explorer links for the settlement and the wager account; the proof cards for each roll.
6. **One next action** — "Choose another stake".

### B9. Start screen

- Fewer words. A hero line: "Keep the haul, or tempt the next guardian."
- **Odds ladder as three gate cards** (door sprite, name, odds, multiplier), because the ladder is the product.
- Stake chips ($2, $5, custom) with the $1.00–$100.00 limit shown as helper text.
- Practice vs Devnet as a segmented control, not two competing cards.
- One primary button. Devnet mode explains the single wallet approval in one sentence.
- Rules and the three-step route guide move into an expandable "How it works".

### B10. Sound

Small and optional: footsteps (soft), torch crackle (loop, very low), padlock rattle, success chime, door slam, coin burst. Off by default, remembered per browser, one mute toggle in the top bar. Use CC0 sources and list them in `assets/LICENSES.md`.

### B11. Accessibility and responsiveness

- Every board action has an equivalent button. Keyboard focus rings are visible.
- Status messages use `aria-live`.
- Contrast: body text against `#110F0A` and `#1A1711` at WCAG AA; check amber on dark for buttons and amber text.
- Respect `prefers-reduced-motion`.
- Don't rely on colour alone: gate states also change shape or icon (padlock open/closed).
- Layouts verified at 375, 768 and 1280.

---

## C. Implementation order

Small, shippable steps. Each ends with lint, build and tests passing.

1. **Tokens and CSS consolidation.** One `:root` token block; replace literals with variables; remove duplicate `.card` rules.
2. **Assets.** Choose a licensed tileset, torch, door/padlock, player and coin sprites. Add `assets/LICENSES.md`.
3. **Board rewrite.** Sprites, `Scale.FIT`, torches, vignette, void. The logic grid and `isWalkable` stay the same.
4. **Gate states.** Locked / ready / rolling / cleared / failed.
5. **Progress track and stats strip.** Replace explanatory prose.
6. **Decision card with the expected-value line.**
7. **Reveal sequence and result screen.**
8. **Start screen.**
9. **Sound and mute toggle.**
10. **Screenshots and tests.** Playwright screenshots at three widths; update selectors in `tests/wager-ui.spec.ts` and `tests/devnet-recovery.spec.ts` if text changes.

If time is short, do steps 1–6. They deliver most of the visible improvement.

## D. Review checklist (use against the reference images)

- [ ] The first screen after Start has one clear bright focal point (the next gate).
- [ ] The world is dark and desaturated; amber appears only on value or decisions.
- [ ] At least two local light sources are visible, and the room edges fade to void.
- [ ] Each gate reads as a distinct locked door and has all five states.
- [ ] A cleared gate has a visible reward moment; a failed gate has a distinct loss moment.
- [ ] The progress track shows three nodes and a skull and updates correctly.
- [ ] The decision card shows an expected-value line computed from `GATES`.
- [ ] The proof card appears after each resolved gate and its Verify button works.
- [ ] `EXTRACTED` / `LOST` / `REFUNDED` appear only after base-layer confirmation.
- [ ] `DEMO CREDITS · NO CASH VALUE` is visible on every screen with a balance.
- [ ] Layouts work at 375, 768 and 1280 with no clipped controls.
- [ ] No third-party art is used without a licence entry.
- [ ] `prefers-reduced-motion` and the mute toggle work.
