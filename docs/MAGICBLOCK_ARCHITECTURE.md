# Loot or Lose — MagicBlock architecture baseline

## Decision

Use an Ephemeral Rollup for low-latency, authoritative runtime `RunState` changes. Keep `PlayerProfile` and final extraction receipts on Solana; terminal extraction commits and undelegates the run.

## Account boundary

| Account | Persistence | ER access | Lifecycle |
| --- | --- | --- | --- |
| `PlayerProfile` PDA | Base-layer settled | Read only during a run | Created once per player |
| `RunState` PDA | Base-layer settled, delegated while active | Read/write | Create on base → delegate → operate on router-resolved ER → commit and undelegate |
| Visual Phaser state | Client-local | None | Disposable prediction only; never authoritative |

## Routing

| Flow | Destination | Confirmation requirement |
| --- | --- | --- |
| Create player/run and delegate | Base-layer devnet RPC | Confirmed base transaction and router delegation status |
| Move, chest, damage, extraction request | ER FQDN returned by `getDelegationStatus` | Confirmed ER transaction plus re-fetched delegated state |
| Commit and undelegate | Same resolved ER FQDN | Confirmed commit and independent base-layer account read |

## Rules locked for the MVP

- Do not hardcode an ER endpoint; resolve it from the router for each delegated run.
- The browser never authorizes its own HP, loot, score, position, or final result.
- Display `EXTRACTED` only after a base-layer re-fetch confirms the committed result.
- Use deterministic/demo loot until a separately tested VRF flow is ready.
