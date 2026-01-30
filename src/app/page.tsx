import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function Home() {
  return (
    <main className="space-y-14">
      <section className="grid gap-10 pt-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <div className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-muted ring-1 ring-border/80 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Crypto options mispricing, with BSM as your baseline
          </div>
          <h1 className="mt-5 font-display text-5xl leading-[1.02] tracking-tight text-foreground md:text-6xl">
            Price the probability.
            <br />
            Hunt the spread.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted md:text-lg">
            BSM.guru pulls market data, estimates volatility, and compares
            theoretical prices to what the market is quoting so you can spot
            relative value fast.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/screener">Open Screener</ButtonLink>
            <ButtonLink href="/pricing" variant="soft">
              Pricing Sandbox
            </ButtonLink>
          </div>

          <p className="mt-4 text-xs text-muted">
            For research. Not financial advice. Markets can (and will) humble
            you.
          </p>
        </div>

        <div className="md:col-span-5">
          <Card className="relative overflow-hidden p-0">
            <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_25%_15%,color-mix(in_oklab,var(--accent)_22%,transparent)_0%,transparent_55%),radial-gradient(circle_at_70%_65%,color-mix(in_oklab,var(--accent2)_22%,transparent)_0%,transparent_58%)]" />
            <div className="relative space-y-5 p-6">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-xs font-medium text-muted">Signal</p>
                  <p className="mt-1 font-mono text-sm text-foreground">
                    mispricing_z
                  </p>
                </div>
                <p className="font-display text-4xl tracking-tight text-foreground">
                  2.4
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
                  <p className="text-xs font-medium text-muted">Market</p>
                  <p className="mt-1 font-mono text-lg text-foreground">
                    0.0129
                  </p>
                </div>
                <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
                  <p className="text-xs font-medium text-muted">BSM</p>
                  <p className="mt-1 font-mono text-lg text-foreground">
                    0.0104
                  </p>
                </div>
              </div>
              <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">Inputs</p>
                <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted">
                  <p>
                    S <span className="font-mono text-foreground">89350</span>
                  </p>
                  <p>
                    K <span className="font-mono text-foreground">90000</span>
                  </p>
                  <p>
                    T <span className="font-mono text-foreground">7d</span>
                  </p>
                  <p>
                    σ <span className="font-mono text-foreground">62%</span>
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <Card className="space-y-3">
          <p className="text-xs font-medium text-muted">01</p>
          <p className="font-display text-2xl tracking-tight text-foreground">
            Baseline fair value
          </p>
          <p className="text-sm leading-6 text-muted">
            Black-Scholes-Merton pricing + greeks with sensible defaults for
            crypto (and knobs when you want them).
          </p>
        </Card>
        <Card className="space-y-3">
          <p className="text-xs font-medium text-muted">02</p>
          <p className="font-display text-2xl tracking-tight text-foreground">
            Volatility options
          </p>
          <p className="text-sm leading-6 text-muted">
            Plug in implied vol, use a historical estimate from candles, or just
            type a number and see the surface move.
          </p>
        </Card>
        <Card className="space-y-3">
          <p className="text-xs font-medium text-muted">03</p>
          <p className="font-display text-2xl tracking-tight text-foreground">
            Screener-first UI
          </p>
          <p className="text-sm leading-6 text-muted">
            Designed for scanning: mid vs fair, edge, IV, and greeks at a glance
            (no spreadsheet archaeology).
          </p>
        </Card>
      </section>
    </main>
  );
}
