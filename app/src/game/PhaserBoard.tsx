"use client";

import { useEffect, useRef } from "react";
import { CHESTS, ENEMY, EXIT, MAP, type DemoState, type Direction } from "./model";

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
        private chests: import("phaser").GameObjects.Rectangle[] = [];
        private keys?: Record<string, import("phaser").Input.Keyboard.Key>;
        private lastStep = 0;
        constructor() { super("dungeon"); }
        create() {
          this.keys = this.input.keyboard?.addKeys("W,A,S,D,UP,RIGHT,DOWN,LEFT") as Record<string, import("phaser").Input.Keyboard.Key> | undefined;
          this.cameras.main.setBackgroundColor("#101113");
          MAP.forEach((row, y) => [...row].forEach((cell, x) => {
            const wall = cell === "#";
            this.add.rectangle(x * tile + tile / 2, y * tile + tile / 2, tile - 1, tile - 1, wall ? 0x33343a : (x + y) % 2 ? 0x202126 : 0x25262b);
            if (wall && (x + y) % 3 === 0) this.add.rectangle(x * tile + 6, y * tile + 6, 3, 3, 0x46474c);
          }));
          this.add.rectangle(EXIT.x * tile + 19, EXIT.y * tile + 19, 28, 28, 0x2c8f89).setStrokeStyle(2, 0x9df4e8);
          this.add.text(EXIT.x * tile + 11, EXIT.y * tile + 10, "⇧", { fontSize: "22px", color: "#e6fffa" });
          CHESTS.forEach((chest) => {
            const box = this.add.rectangle(chest.x * tile + 19, chest.y * tile + 19, 25, 20, 0xc28d40).setStrokeStyle(2, 0xf6d18a);
            this.chests.push(box);
          });
          this.add.circle(ENEMY.x * tile + 19, ENEMY.y * tile + 19, 13, 0x9c5559).setStrokeStyle(2, 0xf1a8ad);
          this.add.text(ENEMY.x * tile + 12, ENEMY.y * tile + 8, "✦", { color: "#fff1f2", fontSize: "19px" });
          this.player = this.add.rectangle(57, 57, 23, 23, 0x78c8c4).setStrokeStyle(2, 0xe5fffd);
          this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
            if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", " "].includes(event.key)) event.preventDefault();
            if (event.key.toLowerCase() === "e" || event.key === " ") callbacks.current.onInteract();
          });
        }
        update(time: number) {
          const current = stateRef.current;
          this.player?.setPosition(current.x * tile + 19, current.y * tile + 19);
          this.chests.forEach((box, id) => box.setFillStyle(current.opened & (1 << id) ? 0x5c5b51 : 0xc28d40));
          if (current.outcome !== "active" || time - this.lastStep < 115) return;
          const keys = this.keys;
          if (!keys) return;
          const direction: Direction | undefined = keys.W.isDown || keys.UP.isDown ? 0 : keys.D.isDown || keys.RIGHT.isDown ? 1 : keys.S.isDown || keys.DOWN.isDown ? 2 : keys.A.isDown || keys.LEFT.isDown ? 3 : undefined;
          if (direction !== undefined) { this.lastStep = time; callbacks.current.onMove(direction); }
        }
      }
      game.current = new Phaser.Game({ type: Phaser.AUTO, width: 608, height: 380, parent: host.current, backgroundColor: "#101113", render: { pixelArt: true }, scene: Dungeon, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    });
    return () => { disposed = true; game.current?.destroy(true); game.current = null; };
  }, []);

  return <div ref={host} className="game-canvas" aria-label="Dungeon map: use WASD or arrow keys to move" />;
}
