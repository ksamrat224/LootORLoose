"use client";

import { useEffect, useRef } from "react";
import {
  CHESTS,
  EARLY_EXIT,
  ENEMY,
  EXIT,
  MAP,
  type DemoState,
  type Direction,
} from "./model";
import { QUESTS } from "./quest-rules";
import { GATES } from "./wager-rules";
import { GUARDIANS } from "./hunt-discovery";

type Props = {
  state: DemoState;
  onMove: (direction: Direction) => void;
  onInteract: () => void;
  wagerMode?: boolean;
  questMode?: boolean;
  gatePhase?: string;
  gateIndex?: number;
  exploration?: { tiles: readonly string[] };
};

export function PhaserBoard({
  state,
  onMove,
  onInteract,
  wagerMode = false,
  questMode = false,
  gatePhase = "active",
  gateIndex = 0,
  exploration,
}: Props) {
  const explorationRef = useRef(exploration);
  explorationRef.current = exploration;
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<import("phaser").Game | null>(null);
  const callbacks = useRef({ onMove, onInteract });
  const stateRef = useRef(state);
  const gateRef = useRef({ phase: gatePhase, index: gateIndex });
  gateRef.current = { phase: gatePhase, index: gateIndex };
  callbacks.current = { onMove, onInteract };
  stateRef.current = state;

  useEffect(() => {
    let disposed = false;
    const observer = new ResizeObserver(() => {
      if (host.current && game.current && questMode)
        game.current.scale.setParentSize(
          host.current.clientWidth,
          host.current.clientHeight,
        );
    });
    if (host.current && questMode) observer.observe(host.current);
    void import("phaser").then((Phaser) => {
      if (disposed || !host.current) return;
      const tile = 38;
      const landmarks = questMode ? QUESTS : GATES;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      class Dungeon extends Phaser.Scene {
        private floors: {
          image: import("phaser").GameObjects.Image;
          key: string;
        }[] = [];
        private lastTiles?: readonly string[];
        private player?: import("phaser").GameObjects.Image;
        private crown?: import("phaser").GameObjects.Rectangle;
        private chests: import("phaser").GameObjects.Image[] = [];
        private keys?: Record<string, import("phaser").Input.Keyboard.Key>;
        private lastStep = 0;
        constructor() {
          super("dungeon");
        }
        preload() {
          this.load.svg("floor-art", "/art/floor.svg");
          this.load.svg("wall-art", "/art/wall.svg");
          this.load.svg("door-art", "/art/door.svg");
          this.load.svg("player-art", "/art/player.svg");
        }
        create() {
          this.keys = this.input.keyboard?.addKeys(
            "W,A,S,D,UP,RIGHT,DOWN,LEFT",
          ) as Record<string, import("phaser").Input.Keyboard.Key> | undefined;
          this.cameras.main.setBackgroundColor("#0e1317");
          MAP.forEach((row, y) =>
            [...row].forEach((cell, x) => {
              const wall = cell === "#";
              const px = x * tile,
                py = y * tile;
              const image = this.add.image(
                px + 19,
                py + 19,
                wall ? "wall-art" : "floor-art",
              );
              if (!wall) this.floors.push({ image, key: `${x},${y}` });
            }),
          );
          if (!wagerMode) {
            this.add
              .rectangle(
                EARLY_EXIT.x * tile + 19,
                EARLY_EXIT.y * tile + 19,
                30,
                30,
                0x3b746c,
              )
              .setStrokeStyle(2, 0xa7ead1);
            this.add.text(
              EARLY_EXIT.x * tile + 11,
              EARLY_EXIT.y * tile + 10,
              "↖",
              { fontSize: "20px", color: "#e6fffa" },
            );
            this.add
              .rectangle(
                EXIT.x * tile + 19,
                EXIT.y * tile + 19,
                30,
                30,
                0x246c79,
              )
              .setStrokeStyle(2, 0x9df4e8);
            this.add.text(EXIT.x * tile + 11, EXIT.y * tile + 10, "↗", {
              fontSize: "20px",
              color: "#e6fffa",
            });
          }
          (wagerMode ? landmarks : CHESTS).forEach((chest, id) => {
            this.add
              .rectangle(
                chest.x * tile + 19,
                chest.y * tile + 25,
                28,
                5,
                0x12171b,
              )
              .setAlpha(0.55);
            const box = this.add.image(
              chest.x * tile + 19,
              chest.y * tile + 17,
              "door-art",
            );
            this.chests.push(box);
            if (wagerMode) {
              const colors = [
                0xf2c46e, 0xcbd2d9, 0x83d7c5, 0xaaa0b8, 0xbab0ed, 0xe39a68,
              ];
              box.setTint(colors[id]);
              this.add
                .text(chest.x * tile + 19, chest.y * tile - 9, `0${id + 1}`, {
                  fontSize: "14px",
                  color: "#f7f1df",
                  fontStyle: "bold",
                  backgroundColor: "#110f0a",
                })
                .setOrigin(0.5);
              const guardian = this.add.circle(
                chest.x * tile + 30,
                chest.y * tile + 29,
                6,
                colors[id],
              );
              if (!reducedMotion.matches)
                this.tweens.add({
                  targets: guardian,
                  y: guardian.y - 4,
                  duration: 1100 + id * 150,
                  yoyo: true,
                  repeat: -1,
                  ease: "Sine.easeInOut",
                });
            }
          });
          if (!wagerMode) {
            this.add.circle(
              ENEMY.x * tile + 19,
              ENEMY.y * tile + 19,
              17,
              0x9c5559,
              0.14,
            );
            this.add
              .circle(ENEMY.x * tile + 19, ENEMY.y * tile + 19, 12, 0x9c5559)
              .setStrokeStyle(2, 0xf1a8ad);
            this.add.text(ENEMY.x * tile + 12, ENEMY.y * tile + 8, "✦", {
              color: "#fff1f2",
              fontSize: "19px",
            });
          }
          this.player = this.add.image(57, 57, "player-art");
          if (wagerMode) {
            [
              { x: 1, y: 1 },
              { x: 14, y: 8 },
            ].forEach(({ x, y }) => {
              const glow = this.add.circle(
                x * tile + 19,
                y * tile + 19,
                75,
                0xe0a34f,
                0.06,
              );
              this.add.circle(x * tile + 19, y * tile + 19, 24, 0xffbf67, 0.09);
              if (!reducedMotion.matches)
                this.tweens.add({
                  targets: glow,
                  alpha: 0.12,
                  duration: 1500,
                  yoyo: true,
                  repeat: -1,
                });
            });
          }
          this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
            if (
              document.querySelector("dialog[open]") ||
              document.activeElement?.matches(
                "button,input,textarea,select,[contenteditable=true]",
              )
            )
              return;
            if (
              ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", " "].includes(
                event.key,
              )
            )
              event.preventDefault();
            if (event.key.toLowerCase() === "e" || event.key === " ")
              callbacks.current.onInteract();
          });
        }
        update(time: number) {
          const current = stateRef.current;
          const tiles = explorationRef.current?.tiles;
          if (tiles !== this.lastTiles) {
            const visible = new Set(tiles);
            this.floors.forEach(({ image, key }) =>
              image.setTint(!tiles || visible.has(key) ? 0xffffff : 0x85817b),
            );
            this.lastTiles = tiles;
          }
          if (this.player) {
            const speed = reducedMotion.matches ? 1 : 0.42;
            this.player.x += (current.x * tile + 19 - this.player.x) * speed;
            this.player.y += (current.y * tile + 19 - this.player.y) * speed;
            this.crown?.setPosition(this.player.x, this.player.y - 14);
          }
          this.chests.forEach((box, id) => {
            if (!wagerMode) {
              box.setTint(current.opened & (1 << id) ? 0x777777 : 0xffffff);
              return;
            }
            const { phase, index } = gateRef.current;
            const accent = explorationRef.current
              ? parseInt(GUARDIANS[id].color.slice(1), 16)
              : 0x777168;
            const cleared = questMode
              ? !!(current.opened & (1 << id)) ||
                (id === index && phase === "succeeded")
              : id < index;
            const failed = phase === "lost" && id === index;
            const ready =
              id === index &&
              (phase === "active" || (questMode && phase === "exploring")) &&
              Math.abs(current.x - landmarks[id].x) +
                Math.abs(current.y - landmarks[id].y) <=
                1;
            box.setTint(
              failed
                ? 0xe36d5f
                : cleared
                ? 0x83d7c5
                : ready
                ? 0xffd47e
                : id === index
                ? 0xd9a452
                : accent,
            );
            box.setAlpha(
              !reducedMotion.matches &&
                phase === "randomnessPending" &&
                id === index
                ? 0.65 + Math.sin(time / 220) * 0.2
                : 1,
            );
          });
          if (
            document.querySelector("dialog[open]") ||
            (explorationRef.current &&
              document.querySelector(".wallet-adapter-dropdown-list-active")) ||
            current.outcome !== "active" ||
            time - this.lastStep < 115
          )
            return;
          if (
            document.activeElement?.matches(
              "input,textarea,select,[contenteditable=true]",
            )
          )
            return;
          const keys = this.keys;
          if (!keys) return;
          const direction: Direction | undefined =
            keys.W.isDown || keys.UP.isDown
              ? 0
              : keys.D.isDown || keys.RIGHT.isDown
              ? 1
              : keys.S.isDown || keys.DOWN.isDown
              ? 2
              : keys.A.isDown || keys.LEFT.isDown
              ? 3
              : undefined;
          if (direction !== undefined) {
            this.lastStep = time;
            callbacks.current.onMove(direction);
          }
        }
      }
      game.current = new Phaser.Game({
        type: Phaser.AUTO,
        width: 608,
        height: 380,
        parent: host.current,
        backgroundColor: "#0e1317",
        audio: { noAudio: true },
        render: { pixelArt: true },
        scene: Dungeon,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      });
      if (questMode && host.current)
        game.current.scale.setParentSize(
          host.current.clientWidth,
          host.current.clientHeight,
        );
    });
    return () => {
      observer.disconnect();
      disposed = true;
      game.current?.destroy(true);
      game.current = null;
    };
  }, [wagerMode, questMode]);

  return (
    <>
      <div
        ref={host}
        className="game-canvas"
        aria-label="Dungeon map: use WASD or arrow keys to move"
      />
      <div className="touch-controls" aria-label="Touch game controls">
        <div className="touch-pad">
          <button aria-label="Move up" onClick={() => onMove(0)}>
            ↑
          </button>
          <div>
            <button aria-label="Move left" onClick={() => onMove(3)}>
              ←
            </button>
            <button aria-label="Move down" onClick={() => onMove(2)}>
              ↓
            </button>
            <button aria-label="Move right" onClick={() => onMove(1)}>
              →
            </button>
          </div>
        </div>
        {exploration && (
          <p className="hunt-key-hints">
            <kbd>WASD</kbd> move <span>·</span> <kbd>E</kbd> interact{" "}
            <span>· walking is safe</span>
          </p>
        )}
        <button
          className="touch-interact"
          aria-label={exploration ? "Interact" : undefined}
          onClick={onInteract}
        >
          {questMode ? "Interact" : wagerMode ? "Risk gate" : "Open chest"}
          {exploration && <span aria-hidden="true"> · E</span>}
        </button>
      </div>
    </>
  );
}
