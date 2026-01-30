import type React from "react";

import { cn } from "@/lib/cn";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-2xl bg-background/60 px-3 text-sm text-foreground ring-1 ring-border/80 backdrop-blur-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      {...props}
    />
  );
}

