import { Card } from "@/components/ui/Card";

export default function AboutPage() {
  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          About
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          BSM.guru is a small research tool: compute Black-Scholes-Merton prices
          and compare them to market quotes to surface potential mispricings.
        </p>
      </header>

      <Card className="space-y-3">
        <p className="text-sm leading-6 text-muted">
          This is not investment advice. If you wire real money to a number you
          saw on a screen without understanding the assumptions (volatility,
          rates, liquidity, settlement, exercise rules), that&apos;s on you.
        </p>
        <p className="text-sm leading-6 text-muted">
          If you tell me which options venue you want to support (native
          Hyperliquid, HyperEVM apps, or another onchain/offchain venue), I can
          wire the screener to live orderbooks.
        </p>
      </Card>
    </main>
  );
}
