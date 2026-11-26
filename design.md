# Loot or Lose — UI Design Spec

A dark, warm "torch-lit dungeon" game dashboard. Gold is the only strong accent. Pixel font for numbers/titles, clean sans for everything else. Rounded, softly shadowed panels over a warm near-black background.

## 1. Fonts
- **Pixel / display:** `Silkscreen` (Google Fonts) — logo, stat values, door numbers, wallet address, stake amounts, keyboard hints.
- **Body:** `Manrope` 400–800 — all other text.
- Load via `<link>`: `https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Silkscreen&display=swap`

## 2. Color tokens (oklch)
| Token | Value | Use |
|---|---|---|
| background | `oklch(0.16 0.012 60)` | page |
| foreground | `oklch(0.95 0.02 85)` | main text (warm off-white) |
| card | `oklch(0.2 0.014 60)` | panels |
| primary (gold) | `oklch(0.8 0.14 78)` | accent, highlights |
| primary-foreground | `oklch(0.2 0.03 60)` | text on gold |
| secondary | `oklch(0.25 0.015 60)` | hover bg, empty bars |
| muted-foreground | `oklch(0.68 0.03 75)` | labels, secondary text |
| accent (ember) | `oklch(0.7 0.16 45)` | doors, second glow |
| success (jade) | `oklch(0.78 0.13 165)` | connected dot |
| border | `oklch(0.32 0.02 65 / 70%)` | all borders |
| floor | `oklch(0.3 0.012 70)` | dungeon floor |
| wall | `oklch(0.42 0.015 70)` | dungeon walls |

- **Gold gradient:** `linear-gradient(180deg, oklch(0.86 0.14 85), oklch(0.72 0.15 65))`
- **Gold glow shadow:** `0 0 0 1px oklch(0.8 0.14 78 / 40%), 0 10px 40px -10px oklch(0.8 0.14 78 / 45%)`
- **Page background:** radial gradient `oklch(0.24 0.03 65)` from the top, fading into the background color.
- Radius base `0.75rem`; panels use radius + 4px.

## 3. Reusable styles
- **panel:** vertical gradient `oklch(0.22 0.015 60 / 90%)` → `oklch(0.18 0.012 60 / 90%)`, 1px border, radius-xl, inset top highlight `inset 0 1px 0 oklch(1 0 0 / 5%)`, drop shadow `0 20px 50px -20px oklch(0 0 0 / 60%)`.
- **btn-gold:** gold gradient bg, dark text, gold glow shadow, `hover: brightness(1.1)`.
- **text-gold:** gold gradient clipped to text.
- **dungeon-floor:** floor color + 2px dark grid lines (32×16 / 32×32 tiles), heavy inset vignette `inset 0 0 120px oklch(0 0 0 / 70%)`.
- **dungeon-wall:** wall color + 3px dark brick lines (48×24), bottom inset shadow.
- **Animations:** `flicker` (opacity .55↔.85, 2.4s) for torch glows; `bob` (translateY 0↔-4px, 2s) for the player.

## 4. Layout (desktop, max-width 1600px, padding 24px, gap 20px)
```text
┌ Header: [gold L badge] LOOT OR LOSE / subtitle        [pill nav: Journal Quests Rules Details Session | 🔇] ┐
├ Stats row: 4 panels — Balance (gold) | Stake | Loot found | Quests opened (+3 progress pips)              ┤
├ Main grid: [ Game area 1fr ]                                  [ Side panel 360px ]                          ┤
│   Map panel 16:10 → wall frame → floor with 2 wall pillars,    Practice/Devnet segmented switch            │
│   6 doors (2 rows × 3), 2 blurred torch glows, player          Wallet card (icon, address, green dot)       │
│   Controls row: 4 arrow buttons | key hint | "Interact · E"    divider · Step label · "Choose a stake"      │
│                                                                $1 $5 $10 · "You are beside X" · CTA · footer│
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 5. Components
- **Header:** logo badge 40px btn-gold square with pixel "L". Title pixel 18px, "OR" in text-gold. Subtitle 11px uppercase, tracking 0.2em, muted. Nav = rounded-full bordered pill, card/60 + backdrop-blur; items rounded-full, muted → foreground + secondary bg on hover.
- **Stat cards:** label 12px uppercase tracking-widest muted; value pixel 24px. Balance uses text-gold. Quests opened shows 3 thin (6px) rounded bars.
- **Map:** panel with padding 12px → wall frame (padding 24px) → floor. Pillars at 36% and 61% from the left, 30% from the top, 30% tall, 5% wide. Torch glows: 192px circles, primary/20 and accent/20, blur-3xl, flicker.
- **Door:** number tag (pixel, small) above an arched door (44×56, rounded top, 4px dark border, ember fill, lock icon) with a colored gem dot bottom-right (gold, gray, ember, white, jade). **Nearest door** = gold tag, scaled 110%, gold glow.
- **Player:** emoji/sprite with drop shadow, bob animation, eases 150ms between positions; moved with WASD/arrows.
- **Controls:** 44px square panel buttons (border turns gold on hover); centered hint with `<kbd>` boxes; primary CTA btn-gold "Interact · E".
- **Side panel:** panel, padding 20px, gap 20px.
  - Segmented switch: background/60 track, the active option is btn-gold.
  - Wallet: bordered row with icon tile, "Wallet connected" label + pixel address, glowing jade dot.
  - Section label 11px uppercase gold; heading 24px bold; body sm muted.
  - Stake chips: 3-column bordered pixel buttons, gold on hover.
  - Context note: primary/10 bg, primary/30 border, place name in gold.
  - Full-width btn-gold CTA, py 14px, bold.
  - Footer pinned to bottom with a top border, xs muted: "Demo credits · no cash value" / "Recovery →".

## 6. Rules
- Dark only; no light-mode toggle. Gold is the only bright color; ember/jade are small accents.
- Never hardcode colors in components — use the tokens above.
- Numbers and short labels use the pixel font; sentences use Manrope.
- Generous spacing, soft depth (gradients + shadows), and glow only on active/primary elements.
