import Link from "next/link";
import type React from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "ghost" | "soft";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

type ButtonLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition will-change-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-foreground text-background shadow-[0_14px_40px_rgba(11,19,32,0.18)] hover:shadow-[0_18px_48px_rgba(11,19,32,0.22)] dark:shadow-[0_14px_40px_rgba(0,0,0,0.45)]",
  soft:
    "bg-card text-foreground ring-1 ring-border/80 hover:bg-background/70 dark:hover:bg-card/80",
  ghost:
    "text-foreground ring-1 ring-border/80 hover:bg-background/70 dark:hover:bg-card/80",
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button className={cn(base, variants[variant], className)} {...props} />
  );
}

export function ButtonLink({
  className,
  variant = "primary",
  href,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(base, variants[variant], className)}
      {...props}
    />
  );
}
