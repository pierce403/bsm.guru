import Link from "next/link";

import { cn } from "@/lib/cn";

const linkBase =
  "rounded-full px-3 py-1.5 text-sm text-muted transition hover:text-foreground hover:bg-background/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Nav() {
  return (
    <header className="mx-auto max-w-6xl px-6 pt-6">
      <div className="flex items-center justify-between rounded-3xl bg-card px-4 py-3 shadow-[var(--shadow)] ring-1 ring-border/80 backdrop-blur-sm">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 rounded-2xl px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="relative grid h-7 w-7 place-items-center rounded-xl bg-foreground text-background shadow-[0_12px_24px_rgba(11,19,32,0.16)] dark:shadow-[0_12px_24px_rgba(0,0,0,0.5)]">
            <span className="font-mono text-[12px] leading-none">BSM</span>
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-[550] tracking-tight text-foreground">
              bsm.guru
            </span>
            <span className="text-xs text-muted">options relative value</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link href="/screener" className={cn(linkBase)}>
            Screener
          </Link>
          <Link href="/pricing" className={cn(linkBase)}>
            Pricing
          </Link>
          <Link href="/wallet" className={cn(linkBase)}>
            Wallet
          </Link>
          <Link href="/about" className={cn(linkBase)}>
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}
