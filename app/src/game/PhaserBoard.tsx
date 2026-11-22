"use client";

import { useEffect, useRef } from "react";
import { CHESTS, EARLY_EXIT, ENEMY, EXIT, MAP, type DemoState, type Direction } from "./model";

type Props = { state: DemoState; onMove: (direction: Direction) => void; onInteract: () => void };

export function PhaserBoard({ state, onMove, onInteract }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<import("phaser").Game | null>(null);
  const callbacks = useRef({ onMove, onInteract });
  const stateRef = useRef(state);
  callbacks.current = { onMove, onInteract };
  stateRef.current = state;

  useEffect(() => {
    let disposed = false;
    void import("phaser").then((Phaser) => {
      if (disposed || !host.current) return;
      const tile = 38;
      class Dungeon extends Phaser.Scene {
        private player?: import("phaser").GameObjects.Rectangle;
        private crown?: import("phaser").GameObjects.Rectangle;
        private chests: import("phaser").GameObjects.Rectangle[] = [];
        private keys?: Record<string, import("phaser").Input.Keyboard.Key>;
        private lastStep = 0;
        constructor() { super("dungeon"); }
        create() {
          this.keys = this.input.keyboard?.addKeys("W,A,S,D,UP,RIGHT,DOWN,LEFT") as Record<string, import("phaser").Input.Keyboard.Key> | undefined;
          this.cameras.main.setBackgroundColor("#0e1317");
          MAP.forEach((row, y) => [...row].forEach((cell, x) => {
            const wall = cell === "#";
            const px = x * tile, py = y * tile;
            this.add.rectangle(px + 19, py + 19, 38, 38, wall ? 0x202832 : (x + y) % 2 ? 0x263138 : 0x2b3439);
            if (wall) {
              this.add.rectangle(px + 19, py + 4, 34, 2, 0x52606a).setAlpha(.55);
              this.add.rectangle(px + 4, py + 19, 2, 34, 0x11191f);
            } else {
              this.add.rectangle(px + 19, py + 19, 33, 33).setStrokeStyle(1, 0x36434a, .55);
              if ((x * 7 + y * 11) % 5 === 0) this.add.rectangle(px + 8, py + 27, 4, 2, 0x66756e).setAlpha(.65);
              if ((x * 3 + y * 5) % 13 === 0) this.add.circle(px + 28, py + 9, 2, 0xa4814b).setAlpha(.55);
            }
          }));
          this.add.rectangle(EARLY_EXIT.x * tile + 19, EARLY_EXIT.y * tile + 19, 30, 30, 0x3b746c).setStrokeStyle(2, 0xa7ead1);
          this.add.text(EARLY_EXIT.x * tile + 11, EARLY_EXIT.y * tile + 10, "↖", { fontSize: "20px", color: "#e6fffa" });
          this.add.rectangle(EXIT.x * tile + 19, EXIT.y * tile + 19, 30, 30, 0x246c79).setStrokeStyle(2, 0x9df4e8);
          this.add.text(EXIT.x * tile + 11, EXIT.y * tile + 10, "↗", { fontSize: "20px", color: "#e6fffa" });
          CHESTS.forEach((chest) => {
            this.add.rectangle(chest.x * tile + 19, chest.y * tile + 25, 28, 5, 0x12171b).setAlpha(.55);
            const box = this.add.rectangle(chest.x * tile + 19, chest.y * tile + 17, 25, 20, 0xb88948).setStrokeStyle(2, 0xf7d38c);
            this.add.rectangle(chest.x * tile + 19, chest.y * tile + 17, 5, 8, 0xf7d38c);
            this.chests.push(box);
          });
          this.add.circle(ENEMY.x * tile + 19, ENEMY.y * tile + 19, 17, 0x9c5559, .14);
          this.add.circle(ENEMY.x * tile + 19, ENEMY.y * tile + 19, 12, 0x9c5559).setStrokeStyle(2, 0xf1a8ad);
          this.add.text(ENEMY.x * tile + 12, ENEMY.y * tile + 8, "✦", { color: "#fff1f2", fontSize: "19px" });
          this.player = this.add.rectangle(57, 57, 22, 25, 0x83d7c5).setStrokeStyle(2, 0xe5fffd);
          this.crown = this.add.rectangle(57, 43, 13, 4, 0xe4c778);
          this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
            if (document.activeElement?.tagName === "BUTTON") return;
            if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", " "].includes(event.key)) event.preventDefault();
            if (event.key.toLowerCase() === "e" || event.key === " ") callbacks.current.onInteract();
          });
        }
        update(time: number) {
          const current = stateRef.current;
          if (this.player) {
            this.player.x += (current.x * tile + 19 - this.player.x) * .42;
            this.player.y += (current.y * tile + 19 - this.player.y) * .42;
            this.crown?.setPosition(this.player.x, this.player.y - 14);
          }
          this.chests.forEach((box, id) => box.setFillStyle(current.opened & (1 << id) ? 0x5c5b51 : 0xc28d40));
          if (current.outcome !== "active" || time - this.lastStep < 115) return;
          const keys = this.keys;
          if (!keys) return;
          const direction: Direction | undefined = keys.W.isDown || keys.UP.isDown ? 0 : keys.D.isDown || keys.RIGHT.isDown ? 1 : keys.S.isDown || keys.DOWN.isDown ? 2 : keys.A.isDown || keys.LEFT.isDown ? 3 : undefined;
          if (direction !== undefined) { this.lastStep = time; callbacks.current.onMove(direction); }
        }
      }
      game.current = new Phaser.Game({ type: Phaser.AUTO, width: 608, height: 380, parent: host.current, backgroundColor: "#0e1317", render: { pixelArt: true }, scene: Dungeon, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    });
    return () => { disposed = true; game.current?.destroy(true); game.current = null; };
  }, []);

  return <><div ref={host} className="game-canvas" aria-label="Dungeon map: use WASD or arrow keys to move" /><div className="touch-controls" aria-label="Touch game controls"><div className="touch-pad"><button aria-label="Move up" onClick={() => onMove(0)}>↑</button><div><button aria-label="Move left" onClick={() => onMove(3)}>←</button><button aria-label="Move down" onClick={() => onMove(2)}>↓</button><button aria-label="Move right" onClick={() => onMove(1)}>→</button></div></div><button className="touch-interact" onClick={onInteract}>Open chest</button></div></>;
}
