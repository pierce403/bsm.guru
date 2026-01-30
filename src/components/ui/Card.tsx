import type React from "react";

import { cn } from "@/lib/cn";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  inset?: boolean;
};

export function Card({ className, inset, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-card p-6 shadow-[var(--shadow)] ring-1 ring-border/80 backdrop-blur-sm",
        inset && "shadow-none bg-background/60",
        className,
      )}
      {...props}
    />
  );
}

