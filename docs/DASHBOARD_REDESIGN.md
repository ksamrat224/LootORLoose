# Dungeon dashboard redesign

The current hunt dashboard follows the supplied `design.md` and [reference dashboard](https://ui-polish-playground.lovable.app/). Changes are scoped to the dungeon and its dialogs. The landing screen, original logo, map, reward economy, program, IDL and transaction helpers are preserved.

## Interface

- One header combines the existing logo, pixel title and desktop navigation. Compact screens use an accessible Game menu with Journal, Quests, Rules, Details, Session, sound and legacy recovery links.
- Four separate stat cards show confirmed demo balance, reserved stake, revealed loot and three progress pips. Pending reveals do not advance the pips. Long text such as Unrevealed uses the body font.
- The dashboard is centered within 1600px, with a 360px desktop sidebar. Shorter screens compact the wallet/mode controls; tablet and phone layouts stack the board above the actions.
- Native wallet selection, public-address copying and disconnect remain adapter actions. The wallet wrapper adds keyboard navigation, Escape and focus restoration. Account menus stay within the viewport and do not move the avatar when navigating with keys.
- $1/$5/$10 shortcuts prefill the stake dialog only. The default remains $2; Start hunt is still explicit. Shortcuts move into the dialog on compact layouts.
- Movement buttons and Interact are grouped beneath the original Phaser board. Movement/action targets are at least 44px; compact mode/wallet controls retain 40px targets.
- Manrope, Silkscreen, warm gold tokens, panel gradients, dialog spacing and visible focus styles follow the new dashboard theme. Fonts are self-hosted by Next.js; source/license notices are recorded in `assets/LICENSES.md` and served under `/licenses/`.
- Next's development indicator is disabled because it covered the first movement button. Compile/runtime errors still surface normally.

## Verification

- ESLint: passed.
- Final full browser suite: **117 passed**. This includes existing legacy/V5/V6/recovery checks plus dashboard layout, explicit stake confirmation, progress, contrast, connected-wallet sizing and keyboard-menu checks.
- Production build: passed using the isolated `.next-live-hunts` output with V6/session controls enabled. Normal environment flags were not changed.
- Targeted checks cover five viewport sizes, explicit stake confirmation, confirmed-only progress, text/action/focus contrast, wallet-menu keyboard input and fully visible connected-wallet actions.
- Reviewed ready, active, pending and settled fixture states at 375×667, 768×900, 1280×720, 844×390 and 1920×1080. Document overflow and hidden main actions were checked. At 375×667, the pending-state canvas remains at least 300px wide.
- Landing screenshot comparison at 1280×720 is byte-identical before/after (SHA-256 `833604131334429218d4b2fe826716430a8ddc58e9dc59fb2dfe2396386cba71`).
- All four SVG hashes match the baseline. Phaser drawing code is unchanged; changes to the shared board concern hunt controls and input suppression while the wallet menu is open.

Original artwork SHA-256:

| Asset | SHA-256 |
| --- | --- |
| door.svg | `d1e1d44f4947053b3472ec4fb26a36a25e3d7b2dead0ace1d99b13d573e4ca30` |
| player.svg | `581fdebb68f4be9b5216254f6bbf42b69574e4970964955b153a69b73d818d69` |
| floor.svg | `065d7f56c3d66c01388ceecccca582ec80ab2e2ebb35cea4f6383ea6ad68c24b` |
| wall.svg | `6a85af489f45aca5319f704b4fb5926b4d953798af3838c3f82ebefa5f6b0c8a` |

## Review artifacts and release limits

Local review artifacts are in `/tmp/loot-dashboard/`: `index.html` compares ready/active/pending/settled/rules screens; `after-<width>-<state>.png` covers all target layouts; connected-wallet screenshots use `after-wallet-ready-<width>.png`. Baseline screenshots were rendered from commit `30a951c` in a temporary checkout. These artifacts use local practice or mocked-wallet fixtures, not live Phantom transactions.

This is a frontend release. Normal-app V6 creation remains disabled, and the [manual Phantom checklist](DEVNET_V6_VERIFICATION.md#manual-phantom--pending) remains pending. No program deployment or new live devnet verification is claimed by the visual checks.
