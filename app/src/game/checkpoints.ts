export type Tile = { x: number; y: number };
export type Step = 0 | 1 | 2 | 3;
const DELTAS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
export type Checkpoint = { nonce: number; path: Step[] };
export class AwaitingCheckpoint extends Error {
  constructor(public nonce: number) {
    super("Confirmed checkpoint is awaiting a readable state");
  }
}

/** Keeps submitted inputs separate from inputs arriving while confirmation is pending. */
export class Checkpoints {
  confirmed: Tile;
  queued: Step[] = [];
  flight: Checkpoint | null = null;
  uncertain = false;
  constructor(
    start: Tile,
    private walkable: (x: number, y: number) => boolean
  ) {
    this.confirmed = start;
  }
  predict(): Tile {
    let point = { ...this.confirmed };
    for (const step of [...(this.flight?.path || []), ...this.queued]) {
      const [dx, dy] = DELTAS[step];
      const next = { x: point.x + dx, y: point.y + dy };
      if (!this.walkable(next.x, next.y)) break;
      point = next;
    }
    return point;
  }
  enqueue(step: Step): boolean {
    if (
      this.uncertain ||
      this.queued.length + (this.flight?.path.length || 0) >= 24
    )
      return false;
    const point = this.predict(),
      [dx, dy] = DELTAS[step];
    if (!this.walkable(point.x + dx, point.y + dy)) return false;
    this.queued.push(step);
    return true;
  }
  begin(nonce: number): Checkpoint | null {
    if (this.flight || this.uncertain || !this.queued.length) return null;
    this.flight = { nonce, path: this.queued.splice(0, 12) };
    return this.flight;
  }
  confirm(point: Tile, nonce: number, active = true) {
    if (this.flight && nonce <= this.flight.nonce)
      throw new Error("Checkpoint is not confirmed yet");
    this.confirmed = { x: point.x, y: point.y };
    this.flight = null;
    this.uncertain = false;
    if (!active) this.queued = [];
    // Validate the remaining prediction from the authoritative position.
    let cursor = { ...this.confirmed };
    this.queued = this.queued.filter((step) => {
      const [dx, dy] = DELTAS[step];
      if (!this.walkable(cursor.x + dx, cursor.y + dy)) return false;
      cursor = { x: cursor.x + dx, y: cursor.y + dy };
      return true;
    });
  }
  reject(point: Tile) {
    this.confirmed = { ...point };
    this.flight = null;
    this.queued = [];
    this.uncertain = false;
  }
}
