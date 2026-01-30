import type React from "react";
import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/cn";

type ModalProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export function Modal({ open, title, onClose, children, className }: ModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // Focus the close button so keyboard users have an obvious escape hatch.
    window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-6 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-full max-w-2xl overflow-hidden rounded-3xl bg-card shadow-[var(--shadow)] ring-1 ring-border/80 backdrop-blur-sm",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-6 border-b border-border/60 px-6 py-5">
          <div className="min-w-0">
            {title ? (
              <h2
                id={titleId}
                className="font-display text-2xl tracking-tight text-foreground"
              >
                {title}
              </h2>
            ) : null}
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-background/60 text-foreground ring-1 ring-border/80 transition hover:bg-background/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            aria-label="Close modal"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

