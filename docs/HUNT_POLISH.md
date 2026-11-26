# Discovery and hunt UI verification

Nov 26, 2026. Frontend-only polish; no program deployment, account-layout change, reward change, migration, extra demo allocation or additional transaction was introduced.

## Implemented behavior

- Floor details brighten within two Manhattan steps, retaining visible walls, paths and all six quest markers. Discovery is saved per hunt and resets for a new hunt.
- Confirmed reveals unlock six original guardian stories, including zero rewards. The journal and optional route badges are cosmetic and local to this browser.
- North Trail: quest IDs 0, 3, 4. South Trail: 1, 2, 5. Across the Vault: at least one quest from each group. Badges unlock only after confirmed collection.
- Practice progress is separate from devnet. Devnet progress is scoped by network, program and public wallet. Guide preferences and discovery metadata use separate versioned storage keys from credits, transaction journals and session records. No private keys are stored.
- Contextual guidance occupies the objective's existing space, is dismissible and can be replayed from Journal. Wallet connection, renewal and recovery messages take precedence.
- Shared dialog spacing, readable proof sections and aligned landscape actions preserve the board and primary decisions.

## Automated and browser checks

- Frontend ESLint: passed.
- Production release-candidate build: passed; V6/session controls are enabled only for the isolated preview.
- Full Playwright suite: **103 passed**. Coverage includes all 20 three-quest combinations, three all-zero hunts earning the appropriate badge, unlock-before/after-collection behavior, reload persistence, new-hunt map reset, guide dismissal/replay, unavailable storage, practice/devnet/disconnected journal isolation, existing session lifecycle/recovery and legacy recovery.
- Journal, quest list, rules, technical details and stake dialogs: no document or dialog horizontal overflow at 375×667, 768×900, 1280×720 and 844×390; Escape and focus restoration checked. Existing session-dialog and gameplay viewport tests pass at the target sizes.
- Desktop, mobile and landscape screenshots reviewed locally. Mobile and landscape action panels fit without scrolling in active practice hunts; the board and all markers remain visible. A separate browser check blocked both storage reads and writes and confirmed practice/journal remained usable.
- Transaction fixture WebSockets now remain inside the fixture, avoiding real-provider confirmation timing during mocked tests. This is automated evidence, not a Phantom pass or new live devnet verification.

## Pending human checks

- New owner feedback on discovery, challenge usefulness and replay value after several hunts. Earlier positive V6 reward-pacing feedback does not establish retention for these additions.
- Required actual-user Phantom scenarios in [the V6 release checklist](DEVNET_V6_VERIFICATION.md#manual-phantom--pending). Normal V6 activation remains disabled until these pass.
- A recorded backup video. [The demo script](HUNT_DEMO.md) is prepared, but no new recording is claimed.

The deployed binary and prior public live evidence remain unchanged. Controlled client interruptions are not provider-outage evidence. Existing abandoned-hunt reservations remain an explicit limitation.
