"use client";
import type { KeyboardEvent } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

/** Keep the adapter's wallet actions; supply keyboard navigation for its menu. */
export function HuntWalletCard() {
  const { connected, connecting } = useWallet();
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const card = event.currentTarget;
    const trigger = card.querySelector<HTMLButtonElement>(
      ".wallet-adapter-button",
    );
    const menu = card.querySelector<HTMLElement>(
      ".wallet-adapter-dropdown-list-active",
    );
    const focusItem = (index: number) => {
      const items = Array.from(
        card.querySelectorAll<HTMLElement>(
          ".wallet-adapter-dropdown-list-active [role=menuitem]",
        ),
      );
      if (!items.length) return;
      items.forEach((item) => {
        item.tabIndex = -1;
      });
      const item = items[(index + items.length) % items.length];
      item.tabIndex = 0;
      item.focus();
    };
    if (!menu) {
      if (
        connected &&
        ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key) &&
        event.target === trigger
      ) {
        event.preventDefault();
        event.stopPropagation();
        trigger?.click();
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            focusItem(event.key === "ArrowUp" ? -1 : 0),
          ),
        );
      }
      return;
    }
    event.stopPropagation();
    if (event.key.startsWith("Arrow")) event.preventDefault();
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      // The adapter closes its own menu on an outside mousedown. No wallet action is invoked.
      card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger?.focus();
      return;
    }
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>("[role=menuitem]"),
    );
    const index = items.indexOf(event.target as HTMLElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      focusItem(
        event.key === "Home"
          ? 0
          : event.key === "End"
          ? -1
          : index < 0
          ? event.key === "ArrowUp"
            ? -1
            : 0
          : index + (event.key === "ArrowDown" ? 1 : -1),
      );
    } else if (index >= 0 && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      items[index].click();
    }
  };
  return (
    <div
      className="hunt-wallet-card"
      role="group"
      aria-label="Devnet wallet"
      onKeyDown={handleKeys}
    >
      <div className="hunt-wallet-caption">
        <span>
          {connected
            ? "Wallet connected"
            : connecting
            ? "Connecting wallet…"
            : "Connect a devnet wallet"}
        </span>
        <i data-connected={connected} aria-hidden="true" />
      </div>
      <WalletMultiButton />
    </div>
  );
}
