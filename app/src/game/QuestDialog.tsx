"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function QuestDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="quest-dialog"
      aria-label={title}
      onCancel={onClose}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="q-icon-button"
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
